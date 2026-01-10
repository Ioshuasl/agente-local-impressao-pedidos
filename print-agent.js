const express = require("express");
const fs = require("fs");
const path = require("path");
const { print, getPrinters } = require("pdf-to-printer");
const PDFDocument = require("pdfkit");
const app = express();
const cors = require("cors");

process.env.NODE_OPTIONS = '--encoding utf-8';

app.use(express.json());
app.use(cors());

const PRINTERS_FILE = path.join(__dirname, "printers.json");

// --- FUNÇÕES AUXILIARES ---
async function updatePrinters() {
  try {
    const printers = await getPrinters();
    fs.writeFileSync(PRINTERS_FILE, JSON.stringify(printers, null, 2));
    return printers;
  } catch (err) {
    console.error("Erro ao listar impressoras:", err);
    return [];
  }
}

updatePrinters();

app.get("/printers", (req, res) => {
  try {
    const data = fs.readFileSync(PRINTERS_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: "Não foi possível carregar impressoras" });
  }
});

// --- GERAÇÃO DO PDF (VISUAL ESPAÇADO E LIMPO) ---
function generatePDF(content) {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(__dirname, `pedido_${content.id}_${Date.now()}.pdf`);

    // Mantivemos as margens pequenas para aproveitar o papel
    const doc = new PDFDocument({
      size: [226.77, 841.89], 
      margins: { top: 10, bottom: 10, left: 5, right: 5 },
      autoFirstPage: true
    });

    const stream = fs.createWriteStream(tempPath);
    doc.pipe(stream);

    doc.font("Helvetica-Bold"); 
    doc.fillColor("#000000");

    const docWidth = doc.page.width;
    const margin = 5;

    // Linha divisória grossa (para seções principais)
    const drawSectionDivider = () => {
      doc.moveDown(0.5);
      doc.strokeColor("#000000").lineWidth(2)
         .moveTo(margin, doc.y).lineTo(docWidth - margin, doc.y)
         .stroke();
      doc.moveDown(0.5);
    };

    // Linha divisória fina (para separar itens do pedido)
    const drawItemDivider = () => {
      doc.moveDown(0.5); // Espaço antes da linha
      doc.strokeColor("#000000").lineWidth(0.5)
         .dash(2, { space: 2 }) // Pontilhada fina
         .moveTo(margin, doc.y).lineTo(docWidth - margin, doc.y)
         .stroke();
      doc.undash(); // Remove pontilhado para o resto
      doc.moveDown(0.5); // Espaço depois da linha
    };

    // --- CABEÇALHO ---
    doc.fontSize(16).text("RECIBO DE PEDIDO", { align: "center" });
    doc.fontSize(12).text(`#${content.id} - ${content.tipoEntrega || 'PEDIDO'}`, { align: "center" });
    
    const orderDate = new Date(content.createdAt);
    doc.fontSize(10).text(`${orderDate.toLocaleDateString("pt-BR")} às ${orderDate.toLocaleTimeString("pt-BR")}`, { align: "center" });

    drawSectionDivider();

    // --- CLIENTE ---
    doc.fontSize(11).text("CLIENTE:");
    doc.fontSize(12).text(`${content.cliente.nome.toUpperCase()}`);
    doc.fontSize(10).text(`Tel: ${content.cliente.telefone}`);

    if (content.cliente.endereco) {
        doc.moveDown(0.3);
        const end = content.cliente.endereco;
        doc.fontSize(10).text(`End: ${end.logadouro}, ${end.numero}`);
        doc.text(`Bairro: ${end.bairro}`);
        if(end.complemento && end.complemento.length > 2) {
             doc.text(`Comp: ${end.complemento}`);
        }
        doc.text(`${end.cidade} - ${end.estado}`);
    } else {
        doc.moveDown(0.3);
        doc.fontSize(12).text("** RETIRADA NO BALCÃO **", { align: "center" });
    }

    drawSectionDivider();

    // --- ITENS ---
    doc.fontSize(11).text("ITENS DO PEDIDO:");
    doc.moveDown(0.5); // Espaço maior antes de começar a lista

    content.itens.forEach((item, index) => {
      const itemTotal = (item.valor * item.quantidade).toFixed(2).replace(".", ",");
      
      // 1. NOME DO PRODUTO (Grande e destacado)
      // Usamos 'continued' false para garantir quebra de linha se for longo, mas aqui vamos controlar manualmente
      doc.fontSize(11).text(`${item.quantidade}x ${item.produto.toUpperCase()}`, { width: 160, continued: true });
      doc.text(`R$ ${itemTotal}`, { align: "right" }); // Preço na mesma linha à direita

      // 2. OBSERVAÇÃO DO ITEM (Com espaçamento)
      if (item.observacaoItem) {
          doc.moveDown(0.3); // Afasta a obs do nome do produto
          doc.fontSize(9)
             .text(`  OBS: ${item.observacaoItem}`, { indent: 10 });
      }

      // 3. SUBITENS (ADICIONAIS)
      if (item.subItens && item.subItens.length > 0) {
        doc.moveDown(0.3); // Afasta os subitens do produto/obs principal
        
        item.subItens.forEach((sub) => {
          const subTotal = (sub.valor * sub.quantidade).toFixed(2).replace(".", ",");
          
          // Adiciona um bullet point (+) para facilitar leitura
          // Espaço extra entre cada subitem (moveDown 0.2)
          doc.moveDown(0.1); 
          doc.fontSize(9).fillColor("#000000")
            .text(`  + ${sub.quantidade}x ${sub.nome}`, { continued: true, indent: 15 }); // Indentação maior (15)
          
          if(sub.valor > 0) {
            doc.text(`R$ ${subTotal}`, { align: "right" });
          } else {
             doc.text(``, { align: "right" }); // Apenas quebra a linha
          }
        });
      }

      // SEPARADOR ENTRE ITENS
      // Se não for o último item, desenha uma linha separadora fina
      if (index < content.itens.length - 1) {
          drawItemDivider();
      } else {
          doc.moveDown(0.5); // Apenas espaço se for o último
      }
    });

    drawSectionDivider();

    // --- TOTAIS ---
    // Pagamento
    doc.fontSize(10).text(`Forma Pagamento:`);
    doc.fontSize(12).text(content.formaPagamento.toUpperCase(), { indent: 10 });

    if (content.observacaoGeral) {
        doc.moveDown(0.5);
        doc.fontSize(10).text("OBSERVAÇÃO GERAL:");
        doc.fontSize(11).text(content.observacaoGeral, { indent: 10 });
    }

    doc.moveDown(1); // Espaço generoso antes dos valores
    
    const printTotalLine = (label, value, isGrandTotal = false) => {
        doc.fontSize(isGrandTotal ? 16 : 11); 
        doc.text(label, { continued: true });
        doc.text(`R$ ${value.toFixed(2).replace(".", ",")}`, { align: "right" });
        if (!isGrandTotal) doc.moveDown(0.2); // Espaço entre linhas de subtotal
    };

    printTotalLine("Subtotal:", content.totais.subtotal);
    printTotalLine("Taxa Entrega:", content.totais.taxaEntrega);
    
    doc.moveDown(0.5); // Espaço antes do total final
    printTotalLine("TOTAL:", content.totais.valorTotal, true);

    drawSectionDivider();
    
    // Rodapé
    doc.fontSize(9).text(content.empresa.razaoSocial, { align: "center" });
    doc.text(".", { align: "left", indent: -100 }); 

    doc.end();

    stream.on("finish", () => resolve(tempPath));
    stream.on("error", (err) => reject(err));
  });
}

// --- RESTO DO CÓDIGO (POST /print) PERMANECE IGUAL ---
app.post("/print", async (req, res) => {
    const payload = req.body;
    if (!payload.printerName || !payload.itens) return res.status(400).json({ error: "Dados inválidos." });

    try {
        const pdfPath = await generatePDF(payload);
        const printOptions = { printer: payload.printerName, monochrome: true };

        await print(pdfPath, printOptions);
        
        setTimeout(() => {
            fs.unlink(pdfPath, (err) => { if (err) console.error("Erro ao limpar PDF:", err); });
        }, 2000);

        console.info(`🧾 Pedido #${payload.id} impresso.`);
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao imprimir:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Print Agent rodando na porta ${PORT} - MODO ESPAÇADO`);
});
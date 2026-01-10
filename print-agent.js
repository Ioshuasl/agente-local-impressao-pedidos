const express = require("express");
const fs = require("fs");
const path = require("path");
const { print, getPrinters } = require("pdf-to-printer");
const PDFDocument = require("pdfkit");
const app = express();
const cors = require("cors");

// Forçar codificação UTF-8 para caracteres especiais
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

// --- ROTAS ---
app.get("/printers", (req, res) => {
  try {
    const data = fs.readFileSync(PRINTERS_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: "Não foi possível carregar impressoras" });
  }
});

// --- GERAÇÃO DO PDF (ALTO CONTRASTE) ---
function generatePDF(content) {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(__dirname, `pedido_${content.id}_${Date.now()}.pdf`);

    // Configurações para bobina de 80mm
    const doc = new PDFDocument({
      size: [226.77, 841.89], 
      margins: { top: 10, bottom: 10, left: 5, right: 5 },
      autoFirstPage: true
    });

    const stream = fs.createWriteStream(tempPath);
    doc.pipe(stream);

    // DEFINE A FONTE GLOBAL COMO NEGRITO E PRETO TOTAL
    doc.font("Helvetica-Bold"); 
    doc.fillColor("#000000");

    const docWidth = doc.page.width;
    const margin = 5;

    // Função helper para desenhar linha SÓLIDA e mais grossa
    const drawDivider = () => {
      doc.moveDown(0.4);
      doc.strokeColor("#000000")
         .lineWidth(1.5) // Linha mais grossa
         .undash() // Garante que não é pontilhada
         .moveTo(margin, doc.y).lineTo(docWidth - margin, doc.y)
         .stroke();
      doc.moveDown(0.4);
    };

    // --- CABEÇALHO (Fontes maiores) ---
    doc.fontSize(16).text("RECIBO DE PEDIDO", { align: "center" });
    doc.fontSize(12).text(`#${content.id} - ${content.tipoEntrega || 'PEDIDO'}`, { align: "center" });
    
    const orderDate = new Date(content.createdAt);
    // Data aumentada para 10
    doc.fontSize(10).text(`${orderDate.toLocaleDateString("pt-BR")} às ${orderDate.toLocaleTimeString("pt-BR")}`, { align: "center" });

    drawDivider();

    // --- DADOS DO CLIENTE (Fonte 10 base) ---
    doc.fontSize(11).text("CLIENTE:");
    doc.fontSize(10).text(`${content.cliente.nome.toUpperCase()}`); // Nome em caixa alta ajuda
    doc.fontSize(10).text(`Tel: ${content.cliente.telefone}`);

    if (content.cliente.endereco) {
        doc.moveDown(0.3);
        const end = content.cliente.endereco;
        // Endereço grande para o entregador ler fácil
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

    drawDivider();

    // --- ITENS DO PEDIDO ---
    doc.fontSize(11).text("ITENS DO PEDIDO:");
    doc.moveDown(0.4);

    content.itens.forEach((item) => {
      const itemTotal = (item.valor * item.quantidade).toFixed(2).replace(".", ",");
      
      // Item principal grande (Fonte 11)
      doc.fontSize(11).text(`${item.quantidade}x ${item.produto.toUpperCase()}`, { continued: true });
      doc.text(`R$ ${itemTotal}`, { align: "right" });

      // Observação do Item (Removido itálico, mantido negrito, fonte 9)
      if (item.observacaoItem) {
          doc.fontSize(9)
             .text(`OBS: ${item.observacaoItem}`, { indent: 10 });
      }

      // Subprodutos (Removido cinza, agora preto total, fonte 9)
      if (item.subItens && item.subItens.length > 0) {
        item.subItens.forEach((sub) => {
          const subTotal = (sub.valor * sub.quantidade).toFixed(2).replace(".", ",");
          
          doc.fontSize(9).fillColor("#000000") // Garante preto
            .text(`+ ${sub.quantidade}x ${sub.nome}`, { continued: true, indent: 10 });
          
          if(sub.valor > 0) {
            doc.text(`R$ ${subTotal}`, { align: "right" });
          } else {
             doc.text(``, { align: "right" });
          }
        });
      }
      doc.moveDown(0.4); // Mais espaço entre itens
    });

    drawDivider();

    // --- TOTAIS (Fontes maiores) ---
    doc.fontSize(10).text(`Pagamento: ${content.formaPagamento.toUpperCase()}`);
    if (content.observacaoGeral) {
        doc.moveDown(0.3);
        doc.fontSize(10).text(`OBS PEDIDO: ${content.observacaoGeral}`);
    }

    doc.moveDown(0.6);
    
    // Função auxiliar para totais com fonte maior
    const printTotalLine = (label, value, isGrandTotal = false) => {
        doc.fontSize(isGrandTotal ? 14 : 11); // Subtotais 11, Total Final 14
        doc.text(label, { continued: true });
        doc.text(`R$ ${value.toFixed(2).replace(".", ",")}`, { align: "right" });
    };

    printTotalLine("Subtotal:", content.totais.subtotal);
    printTotalLine("Taxa Entrega:", content.totais.taxaEntrega);
    doc.moveDown(0.3);
    // Total final bem grande
    printTotalLine("TOTAL A PAGAR:", content.totais.valorTotal, true);

    drawDivider();
    doc.fontSize(9).text(content.empresa.razaoSocial, { align: "center" });
    
    // Ponto final para garantir que a impressora corte o papel depois de tudo
    doc.text(".", { align: "left", indent: -100 }); 

    doc.end();

    stream.on("finish", () => resolve(tempPath));
    stream.on("error", (err) => reject(err));
  });
}

// --- ENDPOINT DE IMPRESSÃO ---
app.post("/print", async (req, res) => {
    const payload = req.body;

    if (!payload.printerName || !payload.itens) {
        return res.status(400).json({ error: "Dados inválidos." });
    }

    try {
        const pdfPath = await generatePDF(payload);
        
        // Opções de impressão para tentar forçar qualidade (depende do driver)
        const printOptions = { 
            printer: payload.printerName,
            monochrome: true // Força driver a entender que é P&B
        };

        await print(pdfPath, printOptions);
        
        // Limpeza do arquivo
        setTimeout(() => {
            fs.unlink(pdfPath, (err) => {
                if (err) console.error("Erro ao limpar PDF:", err);
            });
        }, 2000); // Aumentei tempo para 2s para garantir

        console.info(`🧾 Pedido #${payload.id} impresso em: ${payload.printerName} (Modo Alto Contraste)`);
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao imprimir:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Print Agent rodando na porta ${PORT} - MODO ALTO CONTRASTE`);
});
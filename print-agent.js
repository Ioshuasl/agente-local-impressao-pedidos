const express = require("express");
const fs = require("fs");
const path = require("path");
const { print, getPrinters } = require("pdf-to-printer");
const PDFDocument = require("pdfkit");
const app = express();
const cors = require("cors");

// Forçar codificação UTF-8
process.env.NODE_OPTIONS = '--encoding utf-8';

app.use(express.json());
app.use(cors());

const PRINTERS_FILE = path.join(__dirname, "printers.json");

// --- FUNÇÕES AUXILIARES ---
async function updatePrinters() {
  try {
    const printers = await getPrinters();
    fs.writeFileSync(PRINTERS_FILE, JSON.stringify(printers, null, 2));
    console.info("🖨️ Impressoras carregadas.");
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

// --- GERAÇÃO DO PDF (AJUSTADO PARA NÃO CORTAR LATERAIS) ---
function generatePDF(content) {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(__dirname, `pedido_${content.id}_${Date.now()}.pdf`);

    // AJUSTE CRÍTICO DE MARGENS:
    // Aumentamos left/right para 15 (era 5).
    // Isso centraliza o conteúdo na área imprimível da Epson TM-T20.
    const doc = new PDFDocument({
      size: [226.77, 841.89],
      margins: { top: 10, bottom: 10, left: 15, right: 15 },
      autoFirstPage: true
    });

    const stream = fs.createWriteStream(tempPath);
    doc.pipe(stream);

    doc.font("Helvetica-Bold");
    doc.fillColor("#000000");

    const PAGE_WIDTH = doc.page.width;
    // Margem interna para cálculos de linha (deve ser igual à margem do documento)
    const MARGIN = 15;

    // Largura total disponível para conteúdo
    const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

    // Coluna Preço: 60px
    const PRICE_COL_WIDTH = 60;
    // Coluna Nome: O que sobrar (-5px de respiro)
    const NAME_COL_WIDTH = CONTENT_WIDTH - PRICE_COL_WIDTH - 5;

    // --- HELPER DE COLUNAS ---
    const printRow = (textLeft, textRight, options = {}) => {
      const startY = doc.y;
      const indent = options.indent || 0;
      const fontSize = options.fontSize || 10;

      doc.fontSize(fontSize);

      // 1. Preço (Direita)
      if (textRight) {
        doc.text(textRight, PAGE_WIDTH - MARGIN - PRICE_COL_WIDTH, startY, {
          width: PRICE_COL_WIDTH,
          align: 'right',
          lineBreak: false
        });
      }

      // 2. Nome (Esquerda)
      doc.text(textLeft, MARGIN + indent, startY, {
        width: NAME_COL_WIDTH - indent,
        align: 'left'
      });

      return doc.y;
    };

    // Helper de Linhas
    const drawDivider = (isThick = false) => {
      doc.moveDown(0.5);
      doc.strokeColor("#000000")
        .lineWidth(isThick ? 1.5 : 0.5);

      if (!isThick) doc.dash(2, { space: 2 });
      else doc.undash();

      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke();
      doc.undash();
      doc.moveDown(0.5);
    };

    // --- CONTEÚDO ---

    // Cabeçalho
    doc.fontSize(16).text("RECIBO DE PEDIDO", { align: "center" });
    doc.fontSize(12).text(`#${content.id} - ${content.tipoEntrega || 'PEDIDO'}`, { align: "center" });

    const orderDate = new Date(content.createdAt);
    doc.fontSize(10).text(`${orderDate.toLocaleDateString("pt-BR")} às ${orderDate.toLocaleTimeString("pt-BR")}`, { align: "center" });

    drawDivider(true);

    // Cliente
    doc.fontSize(11).text("CLIENTE:");
    doc.fontSize(12).text(`${content.cliente.nome.toUpperCase()}`);
    doc.fontSize(10).text(`Tel: ${content.cliente.telefone}`);

    if (content.cliente.endereco) {
      doc.moveDown(0.3);
      const end = content.cliente.endereco;

      // 1. Logradouro e Número
      doc.fontSize(10).text(`End: ${end.logadouro}, ${end.numero}`);

      // 2. --- NOVA LÓGICA PARA QUADRA E LOTE ---
      // Verifica se tem Quadra ou Lote e imprime na linha de baixo
      if (end.quadra || end.lote) {
        const txtQuadra = end.quadra ? `Qd. ${end.quadra}` : "";
        const txtLote = end.lote ? `Lt. ${end.lote}` : "";
        const separador = (txtQuadra && txtLote) ? " - " : "";

        doc.text(`${txtQuadra}${separador}${txtLote}`);
      }
      // ------------------------------------------

      doc.text(`Bairro: ${end.bairro}`);

      if (end.complemento && end.complemento.length > 2) {
        doc.text(`Comp: ${end.complemento}`);
      }
      doc.text(`${end.cidade} - ${end.estado}`);
    } else {
      doc.moveDown(0.3);
      doc.fontSize(12).text("** RETIRADA NO BALCÃO **", { align: "center" });
    }

    drawDivider(true);

    // Itens
    doc.fontSize(11).text("ITENS DO PEDIDO:");
    doc.moveDown(0.5);

    content.itens.forEach((item, index) => {
      const itemTotal = (item.valor * item.quantidade).toFixed(2).replace(".", ",");
      const nomeProduto = `${item.quantidade}x ${item.produto.toUpperCase()}`;

      // Linha Principal
      printRow(nomeProduto, `R$ ${itemTotal}`, { fontSize: 11 });

      // Observação
      if (item.observacaoItem) {
        doc.moveDown(0.2);
        printRow(`OBS: ${item.observacaoItem}`, "", { fontSize: 9, indent: 10 });
      }

      // Subitens
      if (item.subItens && item.subItens.length > 0) {
        doc.moveDown(0.2);
        item.subItens.forEach((sub) => {
          const subTotal = (sub.valor * sub.quantidade).toFixed(2).replace(".", ",");
          const nomeSub = `+ ${sub.quantidade}x ${sub.nome}`;
          const textoPrecoSub = sub.valor > 0 ? `R$ ${subTotal}` : "";

          printRow(nomeSub, textoPrecoSub, { fontSize: 9, indent: 15 });
          doc.moveDown(0.1);
        });
      }

      // Separador
      if (index < content.itens.length - 1) {
        drawDivider(false);
      } else {
        doc.moveDown(0.5);
      }
    });

    drawDivider(true);

    // Pagamento
    doc.fontSize(10).text(`Forma Pagamento:`);
    doc.fontSize(12).text(content.formaPagamento.toUpperCase(), { indent: 10 });

    if (content.observacaoGeral) {
      doc.moveDown(0.5);
      doc.fontSize(10).text("OBSERVAÇÃO GERAL:");
      doc.fontSize(11).text(content.observacaoGeral, { indent: 10 });
    }

    doc.moveDown(1);

    // Totais
    printRow("Subtotal:", `R$ ${content.totais.subtotal.toFixed(2).replace(".", ",")}`, { fontSize: 11 });
    doc.moveDown(0.2);
    printRow("Taxa Entrega:", `R$ ${content.totais.taxaEntrega.toFixed(2).replace(".", ",")}`, { fontSize: 11 });
    doc.moveDown(0.5);

    // Total Final
    doc.fontSize(16).text("TOTAL:", { continued: true });
    doc.text(`R$ ${content.totais.valorTotal.toFixed(2).replace(".", ",")}`, { align: "right" });

    drawDivider(true);

    // Rodapé
    doc.fontSize(9).text(content.empresa.razaoSocial, { align: "center" });
    doc.text(".", { align: "left", indent: -100 });

    doc.end();

    stream.on("finish", () => resolve(tempPath));
    stream.on("error", (err) => reject(err));
  });
}

app.post("/print", async (req, res) => {
  const payload = req.body;

  if (!payload.printerName || !payload.itens) {
    return res.status(400).json({ error: "Dados inválidos." });
  }

  try {
    const pdfPath = await generatePDF(payload);

    const printOptions = {
      printer: payload.printerName,
      monochrome: true,
      scale: "noscale" // Importante manter noscale
    };

    console.log(`🖨️ Enviando para: ${payload.printerName}`);
    await print(pdfPath, printOptions);

    // Mantendo timeout de 10s para garantir envio ao buffer
    setTimeout(() => {
      fs.unlink(pdfPath, (err) => {
        if (err) console.error("Erro ao limpar arquivo temp:", err);
      });
    }, 10000);

    res.json({ success: true });
  } catch (err) {
    console.error("Erro CRÍTICO ao imprimir:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Print Agent rodando na porta ${PORT} - MARGENS CORRIGIDAS (15px)`);
});
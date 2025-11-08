const express = require("express");
const fs = require("fs");
const path = require("path");
const { print, getPrinters } = require("pdf-to-printer");
const PDFDocument = require("pdfkit");
const app = express();
const cors = require("cors")

// Forçar codificação UTF-8
process.env.NODE_OPTIONS = '--encoding utf-8';

// O resto do seu código aqui
console.log('Aplicação iniciada com codificação UTF-8');

app.use(express.json());

app.use(cors())

const PRINTERS_FILE = path.join(__dirname, "printers.json");

// Atualiza lista de impressoras
async function updatePrinters() {
  try {
    const printers = await getPrinters();
    fs.writeFileSync(PRINTERS_FILE, JSON.stringify(printers, null, 2));
    console.info("🖨️ Impressoras detectadas:");
    printers.forEach((p, i) =>
      console.info(` ${i + 1}. ${p.name}${p.isDefault ? " (padrão)" : ""}`)
    );
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

app.get("/update-printers", async (req, res) => {
  const printers = await updatePrinters();
  res.json(printers);
});

function generatePDF(content) {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(__dirname, `pedido_${Date.now()}.pdf`);

    // Configurações para um cupom de 80mm
    const doc = new PDFDocument({
      size: [226.77, 841.89], // 80mm de largura
      margins: { top: 15, bottom: 15, left: 10, right: 10 },
    });

    const stream = fs.createWriteStream(tempPath);
    doc.pipe(stream);

    // Definir fonte bold global
    doc.font("Helvetica-Bold"); // Fonte negrito padrão
    const docWidth = doc.page.width;
    const margin = 10;

    // Função para desenhar uma linha tracejada
    const drawDivider = () => {
      doc.moveDown(0.5);
      doc.strokeColor("#000")
         .lineWidth(1)
         .moveTo(margin, doc.y)
         .lineTo(docWidth - margin, doc.y)
         .dash(2, { space: 2 })
         .stroke();
      doc.moveDown(0.5);
    };

    // --- CABEÇALHO ---
    doc.fontSize(12).text("RECIBO DE PEDIDO", { align: "center" });
    doc.fontSize(8).text(`ID do Pedido: #${content.id}`, { align: "center" });
    const orderDate = new Date(content.createdAt);
    doc.text(`Data: ${orderDate.toLocaleDateString("pt-BR")}`, { align: "center" });
    doc.text(`Hora: ${orderDate.toLocaleTimeString("pt-BR")}`, { align: "center" });

    drawDivider();

    // --- DADOS DA EMPRESA ---
    doc.fontSize(9).text(content.empresa.razaoSocial, { align: "center" });
    doc.fontSize(8).text(`CNPJ: ${content.empresa.cnpj}`, { align: "center" });

    drawDivider();

    // --- DADOS DO CLIENTE ---
    doc.fontSize(8).text(`Cliente: ${content.cliente.nome}`);
    doc.text(`Telefone: ${content.cliente.telefone}`);
    doc.text(`Pagamento: ${content.formaPagamento}`);

    drawDivider();

    // --- ITENS ---
    doc.fontSize(10).text("ITENS:");
    doc.moveDown(0.5);

    content.itens.forEach((item) => {
      const itemTotal = (item.valor * item.quantidade).toFixed(2).replace(".", ",");
      doc.fontSize(8).text(`${item.quantidade}x ${item.produto}`, { continued: true });
      doc.text(`R$ ${itemTotal}`, { align: "right" });

      // Subprodutos (agora também em negrito e mais visíveis)
      if (item.subItens && item.subItens.length > 0) {
        item.subItens.forEach((sub) => {
          const subTotal = (sub.valor * sub.quantidade).toFixed(2).replace(".", ",");
          doc.fontSize(8)
            .fillColor("#333")
            .text(`  - ${sub.nome}`, { continued: true, indent: 10 });
          doc.text(`+ R$ ${subTotal}`, { align: "right" });
          doc.fillColor("black");
        });
      }
      doc.moveDown(0.3);
    });

    drawDivider();

    // --- TOTAIS ---
    const { subtotal, taxaEntrega, valorTotal } = content.totais;
    doc.fontSize(8);
    doc.text("Subtotal:", { continued: true });
    doc.text(`R$ ${subtotal.toFixed(2).replace(".", ",")}`, { align: "right" });

    doc.text("Taxa de Entrega:", { continued: true });
    doc.text(`R$ ${taxaEntrega.toFixed(2).replace(".", ",")}`, { align: "right" });

    doc.moveDown(0.5);
    doc.fontSize(9).text("TOTAL:", { continued: true });
    doc.text(`R$ ${valorTotal.toFixed(2).replace(".", ",")}`, { align: "right" });

    drawDivider();

    // --- RODAPÉ ---
    doc.fontSize(8).text("Obrigado pelo seu pedido!", { align: "center" });

    doc.end();
    stream.on("finish", () => resolve(tempPath));
    stream.on("error", (err) => reject(err));
  });
}



app.post("/print", async (req, res) => {
    // Recebe o novo payload completo
    const { printerName, id, createdAt, cliente, empresa, itens, totais, formaPagamento } = req.body;

    if (!printerName || !itens || !totais) {
        return res.status(400).json({ error: "Dados para impressão incompletos." });
    }

    try {
        const pedidoData = { id, createdAt, cliente, empresa, itens, totais, formaPagamento };
        const pdfPath = await generatePDF(pedidoData);

        await print(pdfPath, { printer: printerName });
        fs.unlink(pdfPath, err => {
            if (err) console.error("Falha ao excluir PDF:", err);
        });

        console.info(`🧾 Pedido #${id} enviado para impressora: ${printerName}`);
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao imprimir:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Print Agent rodando na porta ${PORT}`);
  console.log(`Acesse http://localhost:${PORT}/printers`);
});

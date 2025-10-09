# Print Agent + Backend de Pedidos

## Introdução

Este projeto permite que restaurantes recebam pedidos do frontend e os imprimam automaticamente em impressoras conectadas à máquina local. O sistema é composto por duas partes:

1. **Print Agent**: um servidor Node.js local que detecta impressoras, gera PDFs de pedidos e envia para impressão automaticamente.

O fluxo é o seguinte:

* O cliente faz o pedido no frontend (React).
* O backend recebe o pedido e envia para o print-agent na máquina do restaurante.
* O print-agent gera um PDF formatado do pedido e imprime na impressora escolhida.

---

## Requisitos Funcionais

1. Receber pedidos com as seguintes informações:

   * Restaurante (ID)
   * Impressora escolhida
   * Cliente (nome e telefone)
   * Itens do pedido (nome do produto, quantidade, valor)
   * Valor total do pedido

2. Detectar todas as impressoras disponíveis na máquina local e listar via rota HTTP.

3. Gerar PDF do pedido automaticamente e enviar para a impressora.

4. Permitir múltiplos pedidos consecutivos e imprimir cada um automaticamente.

5. O print-agent deve poder iniciar junto com o Windows, garantindo operação contínua.

---

## Estrutura de Pastas

### Print Agent

```
print-agent/
├── node_modules/
├── printers.json            # Lista de impressoras detectadas
├── print-agent.js           # Script principal do print agent
├── package.json
└── package-lock.json
```

---

## Instalação e Execução

### Print Agent (Local no Restaurante)

1. Clonar ou copiar a pasta `print-agent` para a máquina do restaurante.
2. Instalar dependências (somente se for rodar com Node.js):

```bash
npm install
```

3. Rodar o agente:

```bash
node print-agent.js
```

4. **Opcional:** gerar executável para não precisar instalar Node.js:

```bash
pkg print-agent.js --targets node18-win-x64 --output print-agent.exe
```

5. Colocar o `print-agent.exe` na pasta de inicialização do Windows (`shell:startup`) para iniciar automaticamente.
6. Acessar lista de impressoras:

```
GET http://localhost:4000/printers
```

```json
{
  "restauranteId": "rest-1",
  "printerName": "Nome da impressora",
  "cliente": { "nome": "João Silva", "telefone": "(11) 99999-9999" },
  "itens": [
    { "produto": "Pizza Calabresa", "quantidade": 1, "valor": 45.00 },
    { "produto": "Coca-Cola 2L", "quantidade": 2, "valor": 12.00 }
  ],
  "valorTotal": 69.00
}
```

* **GET /api/pedidos**: listar todos os pedidos (em memória).

---

## Observações

* Atualmente os pedidos são salvos **em memória** no backend. Pode ser alterado para PostgreSQL, MySQL ou outro banco.
* Print-agent pode imprimir em qualquer impressora conectada ou gerar PDFs automaticamente (ex.: Microsoft Print to PDF).
* Recomenda-se criar uma pasta fixa para PDFs temporários e logs do print-agent para facilitar depuração.

---

## Tecnologias

* Node.js
* Express
* PDFKit
* pdf-to-printer
* Axios

---

## Autor

Ioshua Souza

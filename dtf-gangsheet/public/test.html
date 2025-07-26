<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DTF Gang Sheet Generator</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f8f9fa;
      color: #333;
      padding: 20px;
      max-width: 700px;
      margin: 0 auto;
    }

    h1 {
      text-align: center;
      font-size: 1.8rem;
      margin-bottom: 20px;
    }

    .form-card {
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.05);
      margin-bottom: 20px;
    }

    label {
      display: block;
      font-weight: 600;
      margin: 10px 0 5px;
    }

    input[type="number"],
    select,
    input[type="file"] {
      width: 100%;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 5px;
      font-size: 14px;
    }

    button {
      background: #007bff;
      color: #fff;
      border: none;
      padding: 10px 15px;
      font-size: 16px;
      border-radius: 5px;
      cursor: pointer;
      margin-top: 15px;
    }

    button:hover {
      background: #0056b3;
    }

    hr {
      margin: 25px 0;
    }

    .result-card {
      background: #fff;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.05);
    }

    .sheet-item {
      margin: 8px 0;
      padding: 10px;
      background: #f1f1f1;
      border-radius: 5px;
    }

    .cost {
      color: #28a745;
      font-weight: bold;
      margin-left: 8px;
    }

    .download-all {
      background: #28a745;
      margin-top: 15px;
    }

    .download-all:hover {
      background: #1e7e34;
    }

    .loading {
      font-weight: bold;
      color: #ff9800;
    }
  </style>
</head>
<body>

  <h1>DTF Gang Sheet Generator</h1>

  <div class="form-card">
    <form id="uploadForm">
      <label>Select PDF file</label>
      <input type="file" id="file" required />

      <label>Quantity</label>
      <input type="number" id="quantity" min="1" required />

      <label>Rotate 90°?</label>
      <select id="rotate">
        <option value="false">No</option>
        <option value="true">Yes</option>
      </select>

      <label>Gang Sheet Width</label>
      <select id="gangWidth">
        <option value="22" selected>22 inches</option>
        <option value="30">30 inches</option>
      </select>

      <label>Max Sheet Length (inches)</label>
      <input type="number" id="maxLength" min="12" value="200" />

      <button type="submit">Generate Gang Sheet</button>
    </form>
  </div>

  <div id="log"></div>

  <script>
    const form = document.getElementById("uploadForm");
    const logDiv = document.getElementById("log");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      logDiv.innerHTML = `<p class="loading">⏳ Generating sheets...</p>`;

      const file = document.getElementById("file").files[0];
      const quantity = document.getElementById("quantity").value;
      const rotate = document.getElementById("rotate").value;
      const gangWidth = document.getElementById("gangWidth").value;
      const maxLength = document.getElementById("maxLength").value;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("quantity", quantity);
      formData.append("rotate", rotate);
      formData.append("gangWidth", gangWidth);
      formData.append("maxLength", maxLength);

      const response = await fetch("/merge", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        logDiv.innerHTML = `<p style="color:red;">❌ Server error! Please try again.</p>`;
        return;
      }

      const data = await response.json();

      let html = `
        <div class="result-card">
          <h3>✅ ${data.sheets.length} sheet(s) generated</h3>
          <ul>
      `;

      data.sheets.forEach((s) => {
        html += `
          <li class="sheet-item">
            📄 ${s.filename} 
            <span class="cost">💰 $${s.cost.toFixed(2)}</span> 
            <a href="data:application/pdf;base64,${s.pdfBase64}" download="${s.filename}">⬇️ Download</a>
          </li>
        `;
      });

      html += `</ul>
        <p><strong>Total Cost: $${data.totalCost.toFixed(2)}</strong></p>
        <button id="downloadAll" class="download-all">⬇️ Download All</button>
        </div>
      `;

      logDiv.innerHTML = html;

      document.getElementById("downloadAll").addEventListener("click", () => {
        data.sheets.forEach((s) => {
          const a = document.createElement("a");
          a.href = `data:application/pdf;base64,${s.pdfBase64}`;
          a.download = s.filename;
          a.click();
        });
      });
    });
  </script>

</body>
</html>

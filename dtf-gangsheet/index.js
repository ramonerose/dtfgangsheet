import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

app.get("/", (req, res) => {
  res.send("✅ Gang Sheet backend with separate sheet downloads is running!");
});

// Temporary in-memory store for generated PDFs
const generatedSheets = {};

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0");
    const jobId = Date.now().toString(); // unique ID for this job

    const uploadedPDF = req.file.buffer;

    // Load original logo PDF
    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await srcDoc.embedPages([srcDoc.getPage(0)]);

    const originalWidth = embeddedPage.width;
    const originalHeight = embeddedPage.height;

    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;
    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    console.log(`🧠 Can fit ${perRow} logos across per row`);

    let remaining = qty;
    let placedTotal = 0;

    // Store all generated sheets
    const sheetsForThisJob = [];

    while (remaining > 0) {
      // How many rows can we fit on a full 22x200 sheet?
      const maxPossibleRows = Math.floor(
        (maxSheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );

      // Rows needed for the leftover logos
      const rowsNeededForRemaining = Math.ceil(remaining / perRow);

      // Actual rows we’ll use on this sheet
      const rowsForThisSheet = Math.min(rowsNeededForRemaining, maxPossibleRows);

      // Raw height for those rows
      let requiredHeightPts =
        marginPts * 2 +
        rowsForThisSheet * logoHeightPts +
        (rowsForThisSheet - 1) * spacingPts;

      // Convert to inches, round up
      let rawInches = requiredHeightPts / POINTS_PER_INCH;
      let roundedHeightInches = Math.ceil(rawInches);
      if (roundedHeightInches > MAX_SHEET_HEIGHT_INCH) {
        roundedHeightInches = MAX_SHEET_HEIGHT_INCH;
      }
      const sheetHeightPts = roundedHeightInches * POINTS_PER_INCH;

      console.log(
        `📏 Creating sheet: raw ${rawInches.toFixed(2)}" → rounded to ${roundedHeightInches}"`
      );

      // Create a NEW PDF for this sheet
      const gangDoc = await PDFDocument.create();
      const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

      let placedOnThisSheet = 0;

      // Fill the sheet
      for (let row = 0; row < rowsForThisSheet && remaining > 0; row++) {
        for (let col = 0; col < perRow && remaining > 0; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY =
            sheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          gangPage.drawPage(embeddedPage, {
            x: isRotated ? baseX + logoWidthPts : baseX,
            y: baseY,
            width: originalWidth,
            height: originalHeight,
            rotate: isRotated ? degrees(90) : undefined,
          });

          remaining--;
          placedTotal++;
          placedOnThisSheet++;
        }
      }

      console.log(`✅ Placed ${placedOnThisSheet} logos on this sheet`);

      // Save this sheet as its own PDF buffer
      const sheetBuffer = await gangDoc.save();

      // Filename for THIS sheet
      const filename = `gangsheet_${SHEET_WIDTH_INCH}x${roundedHeightInches}.pdf`;

      sheetsForThisJob.push({
        filename,
        buffer: sheetBuffer,
        logos: placedOnThisSheet,
      });
    }

    console.log(`✅ Total placed across all sheets: ${placedTotal}`);

    // Store these generated sheets in memory for download
    generatedSheets[jobId] = sheetsForThisJob;

    // Respond with an HTML list of download links
    let html = `<h2>✅ Your gang sheets are ready</h2>`;
    html += `<p>Total: ${placedTotal} logos</p>`;
    html += `<ul>`;
    sheetsForThisJob.forEach((sheet, index) => {
      html += `<li><a href="/download/${jobId}/${index}" target="_blank">${sheet.filename}</a> – ${sheet.logos} logos</li>`;
    });
    html += `</ul>`;

    res.send(html);

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error generating gang sheets");
  }
});

// Route to download a specific sheet
app.get("/download/:jobId/:sheetIndex", (req, res) => {
  const { jobId, sheetIndex } = req.params;
  const jobSheets = generatedSheets[jobId];
  if (!jobSheets) {
    return res.status(404).send("❌ Job not found or expired");
  }

  const sheet = jobSheets[sheetIndex];
  if (!sheet) {
    return res.status(404).send("❌ Sheet not found");
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${sheet.filename}`);
  res.setHeader("Content-Length", sheet.buffer.length);
  res.end(Buffer.from(sheet.buffer));
});

// Cleanup job cache periodically (optional)
setInterval(() => {
  for (const key in generatedSheets) {
    delete generatedSheets[key];
  }
  console.log("🧹 Cleared old generated sheets from memory");
}, 1000 * 60 * 30); // every 30 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

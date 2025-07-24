import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import JSZip from "jszip"; // ✅ new dependency

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

// constants for sheet size
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200; // max sheet height
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

app.get("/", (req, res) => {
  res.send("✅ Gang Sheet backend with zip support is running!");
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0");

    const uploadedPDF = req.file.buffer;

    // Load the source logo PDF once
    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await srcDoc.embedPages([srcDoc.getPage(0)]);

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    // Handle rotated dimensions
    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    console.log(`🧠 Can fit ${perRow} logos per row`);

    let remaining = qty;
    let sheetIndex = 1;
    const generatedSheets = []; // Array of { name, buffer }

    while (remaining > 0) {
      // Calculate rows needed for remaining logos
      const rowsNeeded = Math.ceil(remaining / perRow);

      // Calculate required height for those rows
      const requiredHeightPts =
        marginPts * 2 + rowsNeeded * logoHeightPts + (rowsNeeded - 1) * spacingPts;

      // Cap at max allowed height (200 inches)
      let sheetHeightPts = Math.min(requiredHeightPts, maxSheetHeightPts);

      // How many rows fit on THIS sheet
      const rowsPerSheet = Math.floor(
        (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );

      const maxPerSheet = rowsPerSheet * perRow;
      console.log(`📄 Sheet ${sheetIndex} can fit up to ${maxPerSheet} logos`);

      // Adjust actual sheet height to used rows
      const usedHeightPts =
        marginPts * 2 +
        rowsPerSheet * logoHeightPts +
        (rowsPerSheet - 1) * spacingPts;

      // ✅ Round UP to next full inch
      const roundedHeightInches = Math.ceil(usedHeightPts / POINTS_PER_INCH);
      sheetHeightPts = roundedHeightInches * POINTS_PER_INCH;

      // Create a new PDF for THIS sheet
      const sheetDoc = await PDFDocument.create();
      const sheetPage = sheetDoc.addPage([sheetWidthPts, sheetHeightPts]);

      let placedOnThisSheet = 0;

      // Place logos row by row
      for (let row = 0; row < rowsPerSheet && remaining > 0; row++) {
        for (let col = 0; col < perRow && remaining > 0; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY =
            sheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          if (rotateAngle === 90) {
            sheetPage.drawPage(embeddedPage, {
              x: baseX + logoWidthPts,
              y: baseY,
              width: originalWidth,
              height: originalHeight,
              rotate: degrees(90),
            });
          } else {
            sheetPage.drawPage(embeddedPage, {
              x: baseX,
              y: baseY,
              width: originalWidth,
              height: originalHeight,
            });
          }

          remaining--;
          placedOnThisSheet++;
        }
      }

      console.log(`✅ Placed ${placedOnThisSheet} logos on sheet ${sheetIndex}`);

      // Save this single sheet
      const sheetBuffer = await sheetDoc.save();
      const sheetName = `gangsheet_${SHEET_WIDTH_INCH}x${roundedHeightInches}.pdf`;

      // Store it
      generatedSheets.push({ name: sheetName, data: sheetBuffer });

      sheetIndex++;
    }

    console.log(`✅ Finished! Total sheets generated: ${generatedSheets.length}`);

    // ✅ If only ONE sheet → just return that PDF
    if (generatedSheets.length === 1) {
      const sheet = generatedSheets[0];
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${sheet.name}`);
      res.setHeader("Content-Length", sheet.data.length);
      return res.end(Buffer.from(sheet.data));
    }

    // ✅ If MULTIPLE sheets → build a ZIP archive
    const zip = new JSZip();
    generatedSheets.forEach(sheet => {
      zip.file(sheet.name, sheet.data);
    });

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=gangsheets.zip");
    res.setHeader("Content-Length", zipBuffer.length);
    res.end(zipBuffer);

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error generating gang sheets");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

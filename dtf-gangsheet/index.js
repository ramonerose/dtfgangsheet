import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Serve static files like test.html from the public folder
app.use(express.static("public"));

// constants for sheet size
const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200; // max sheet height
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

// ✅ Helper to calculate how logos fit
function calculateSheetLayout(qty, logoWidthPts, logoHeightPts) {
  const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
  const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

  const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
  const spacingPts = SPACING_INCH * POINTS_PER_INCH;

  const usableWidth = sheetWidthPts - marginPts * 2;
  const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

  let remaining = qty;
  const sheets = [];
  const totalLayout = {
    perRow,
    sheets: []
  };

  while (remaining > 0) {
    // Rows needed for remaining logos
    const rowsNeeded = Math.ceil(remaining / perRow);

    // Required height for these rows
    const requiredHeightPts =
      marginPts * 2 + rowsNeeded * logoHeightPts + (rowsNeeded - 1) * spacingPts;

    // Cap height to max allowed
    const sheetHeightPts = Math.min(requiredHeightPts, maxSheetHeightPts);

    const rowsPerSheet = Math.floor(
      (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
    );
    const maxPerSheet = rowsPerSheet * perRow;

    // How many logos we can place on this sheet
    const placing = Math.min(maxPerSheet, remaining);

    // Save sheet info
    sheets.push({
      sheetHeightInches: sheetHeightPts / POINTS_PER_INCH,
      logosOnThisSheet: placing
    });

    remaining -= placing;
  }

  totalLayout.sheets = sheets;
  totalLayout.totalSheets = sheets.length;
  totalLayout.rowsPerSheet = sheets.length > 0 ? Math.floor(
    (sheets[0].sheetHeightInches * POINTS_PER_INCH - marginPts * 2 + spacingPts) /
      (logoHeightPts + spacingPts)
  ) : 0;
  totalLayout.logosPerSheet = sheets.length > 0 ? totalLayout.rowsPerSheet * perRow : 0;

  return totalLayout;
}

// ✅ Preview route
app.post("/preview", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0"); // 0 or 90

    const uploadedPDF = req.file.buffer;
    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await srcDoc.embedPages([srcDoc.getPage(0)]);

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    // Handle rotated dimensions
    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const layout = calculateSheetLayout(qty, logoWidthPts, logoHeightPts);

    res.json({
      perRow: layout.perRow,
      rowsPerSheet: layout.rowsPerSheet,
      logosPerSheet: layout.logosPerSheet,
      totalSheets: layout.totalSheets,
      sheets: layout.sheets
    });
  } catch (err) {
    console.error("❌ PREVIEW ERROR:", err);
    res.status(500).send("❌ Error generating preview");
  }
});

// ✅ Existing /merge route (same as last working version)
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0"); // 0 or 90

    const uploadedPDF = req.file.buffer;

    const gangDoc = await PDFDocument.create();
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await gangDoc.embedPdf(await srcDoc.save());

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    // Handle rotated dimensions
    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    console.log(`🧠 Can fit ${perRow} logos across per row`);

    let remaining = qty;
    let placedTotal = 0;

    while (remaining > 0) {
      // Rows needed for remaining logos
      const rowsNeeded = Math.ceil(remaining / perRow);

      // Calculate required height for these rows
      const requiredHeightPts =
        marginPts * 2 + rowsNeeded * logoHeightPts + (rowsNeeded - 1) * spacingPts;

      // Cap height to max allowed
      const sheetHeightPts = Math.min(requiredHeightPts, maxSheetHeightPts);

      const rowsPerSheet = Math.floor(
        (sheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );
      const maxPerSheet = rowsPerSheet * perRow;

      console.log(`📄 This sheet can fit up to ${maxPerSheet} logos`);

      // Create a new sheet page
      const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

      let placedOnThisSheet = 0;

      // Fill this sheet
      for (let row = 0; row < rowsPerSheet && remaining > 0; row++) {
        for (let col = 0; col < perRow && remaining > 0; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY =
            sheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

          if (rotateAngle === 90) {
            gangPage.drawPage(embeddedPage, {
              x: baseX + logoWidthPts,
              y: baseY,
              width: originalWidth,
              height: originalHeight,
              rotate: degrees(90)
            });
          } else {
            gangPage.drawPage(embeddedPage, {
              x: baseX,
              y: baseY,
              width: originalWidth,
              height: originalHeight
            });
          }

          remaining--;
          placedTotal++;
          placedOnThisSheet++;
        }
      }

      console.log(`✅ Placed ${placedOnThisSheet} logos on this sheet`);
    }

    console.log(`✅ Placed total of ${placedTotal} logos across all sheets`);

    const finalPDF = await gangDoc.save();

    // ✅ Railway-safe binary response (prevents corruption)
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=gangsheet.pdf");
    res.setHeader("Content-Length", finalPDF.length);
    res.end(Buffer.from(finalPDF)); // send as raw binary

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error merging PDF");
  }
});

// ✅ Use Railway port or fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Constants
const SHEET_WIDTH_INCH = 22;          // fixed width
const MAX_SHEET_HEIGHT_INCH = 200;    // max height for one sheet
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

// Serve the HTML UI
app.use(express.static("public"));

// PDF merge logic
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "1");
    const rotateFlag = req.query.rotate === "yes";

    // Load the uploaded single-page PDF
    const uploadedPDF = req.file.buffer;
    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await srcDoc.embedPages([srcDoc.getPage(0)]);

    // Original logo width/height
    const originalWidth = embeddedPage.width;
    const originalHeight = embeddedPage.height;

    // Adjust if rotated
    const logoWidthPts = rotateFlag ? originalHeight : originalWidth;
    const logoHeightPts = rotateFlag ? originalWidth : originalHeight;

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const usableWidth = sheetWidthPts - marginPts * 2;
    const usableHeightMax = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH - marginPts * 2;

    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));
    const perColMax = Math.floor((usableHeightMax + spacingPts) / (logoHeightPts + spacingPts));

    const logosPerFullSheet = perRow * perColMax;

    console.log(`Each full 22x200 sheet can fit ${logosPerFullSheet} logos`);

    // How many sheets are needed?
    let remaining = qty;
    const totalSheetsNeeded = Math.ceil(qty / logosPerFullSheet);

    // Create final PDF doc
    const finalDoc = await PDFDocument.create();

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      const logosOnThisSheet = Math.min(logosPerFullSheet, remaining);

      // Determine required sheet height based on how many rows are needed
      const rowsNeeded = Math.ceil(logosOnThisSheet / perRow);
      const requiredHeightPts =
        rowsNeeded * logoHeightPts +
        (rowsNeeded - 1) * spacingPts +
        marginPts * 2;

      // Always round UP to next inch
      const requiredHeightInches = Math.ceil(requiredHeightPts / POINTS_PER_INCH);
      const finalHeightPts = requiredHeightInches * POINTS_PER_INCH;

      console.log(
        `Sheet ${sheetIndex + 1}: placing ${logosOnThisSheet} logos, final height = 22x${requiredHeightInches}`
      );

      // Create a new sheet
      const page = finalDoc.addPage([sheetWidthPts, finalHeightPts]);

      // Place logos
      let placed = 0;
      for (let row = 0; row < rowsNeeded && placed < logosOnThisSheet; row++) {
        for (let col = 0; col < perRow && placed < logosOnThisSheet; col++) {
          const baseX = marginPts + col * (logoWidthPts + spacingPts);
          const baseY =
            finalHeightPts -
            marginPts -
            (row + 1) * logoHeightPts -
            row * spacingPts;

          page.drawPage(embeddedPage, {
            x: rotateFlag ? baseX + logoWidthPts : baseX,
            y: baseY,
            width: originalWidth,
            height: originalHeight,
            rotate: rotateFlag ? degrees(90) : undefined,
          });

          placed++;
        }
      }

      remaining -= logosOnThisSheet;
    }

    // Save final combined PDF
    const finalPDF = await finalDoc.save();
    const outputName = `gangsheet_combined.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${outputName}`);
    res.send(finalPDF);

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error generating gang sheets");
  }
});

// Run server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

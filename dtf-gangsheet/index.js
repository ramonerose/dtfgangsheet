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

// Simple root route just to confirm it's running
app.get("/", (req, res) => {
  res.send("✅ Gang Sheet PDF backend with full 200-inch packing is running!");
});

// ✅ PDF-only merge route with full-height packing
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
      // --- HOW MANY ROWS CAN WE FIT IN 200 INCHES? ---
      const maxPossibleRows = Math.floor(
        (maxSheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );

      // Logos that can fit in a full 22x200
      const maxPerFullSheet = maxPossibleRows * perRow;

      // If fewer logos remain than a full sheet can hold, we only need enough rows for remaining logos
      const rowsNeededForRemaining = Math.ceil(remaining / perRow);

      // Actual rows we’ll draw = smaller of (rows needed for remaining) vs (max rows allowed in 200 inches)
      const rowsForThisSheet = Math.min(rowsNeededForRemaining, maxPossibleRows);

      // Compute actual sheet height based on rowsForThisSheet
      let requiredHeightPts =
        marginPts * 2 +
        rowsForThisSheet * logoHeightPts +
        (rowsForThisSheet - 1) * spacingPts;

      // ✅ CAP it at max height if somehow slightly over
      if (requiredHeightPts > maxSheetHeightPts) {
        requiredHeightPts = maxSheetHeightPts;
      }

      const sheetHeightPts = requiredHeightPts;

      console.log(
        `📏 This sheet will use ${rowsForThisSheet} rows → height ${(sheetHeightPts / POINTS_PER_INCH).toFixed(2)} inches`
      );

      // Create the new sheet
      const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

      let placedOnThisSheet = 0;

      // Fill the rows
      for (let row = 0; row < rowsForThisSheet && remaining > 0; row++) {
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
              rotate: degrees(90),
            });
          } else {
            gangPage.drawPage(embeddedPage, {
              x: baseX,
              y: baseY,
              width: originalWidth,
              height: originalHeight,
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

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
  res.send("✅ Gang Sheet PDF backend with per-sheet rounding is running!");
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0");

    const uploadedPDF = req.file.buffer;

    const gangDoc = await PDFDocument.create();
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;

    const srcDoc = await PDFDocument.load(uploadedPDF);
    const [embeddedPage] = await gangDoc.embedPdf(await srcDoc.save());

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

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

    // Track tallest sheet for overall filename
    let tallestSheetInches = 0;

    while (remaining > 0) {
      const maxPossibleRows = Math.floor(
        (maxSheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
      );

      const rowsNeededForRemaining = Math.ceil(remaining / perRow);
      const rowsForThisSheet = Math.min(rowsNeededForRemaining, maxPossibleRows);

      // Raw required height
      let requiredHeightPts =
        marginPts * 2 +
        rowsForThisSheet * logoHeightPts +
        (rowsForThisSheet - 1) * spacingPts;

      // Convert to inches
      const usedHeightInches = requiredHeightPts / POINTS_PER_INCH;

      // ✅ Round UP to next full inch for this sheet
      let roundedHeightInches = Math.ceil(usedHeightInches);

      // Cap at 200 if needed
      if (roundedHeightInches > MAX_SHEET_HEIGHT_INCH) {
        roundedHeightInches = MAX_SHEET_HEIGHT_INCH;
      }

      // Convert back to points
      const sheetHeightPts = roundedHeightInches * POINTS_PER_INCH;

      // Track largest height for final filename
      if (roundedHeightInches > tallestSheetInches) {
        tallestSheetInches = roundedHeightInches;
      }

      console.log(
        `📏 This sheet → raw ${usedHeightInches.toFixed(2)}" → rounded to ${roundedHeightInches}"`
      );

      // Create this sheet page
      const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

      let placedOnThisSheet = 0;

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

      console.log(`✅ Placed ${placedOnThisSheet} logos on this rounded sheet`);
    }

    console.log(`✅ Placed total of ${placedTotal} logos across all sheets`);

    const finalPDF = await gangDoc.save();

    // ✅ Name the file using the TALLEST sheet height among all sheets
    const filename = `gangsheet_${SHEET_WIDTH_INCH}x${tallestSheetInches}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Length", finalPDF.length);
    res.end(Buffer.from(finalPDF));

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error merging PDF");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

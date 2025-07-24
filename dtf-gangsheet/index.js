import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Keep serving UI files
app.use(express.static("public"));

const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

app.get("/", (req, res) => {
  res.send("✅ Test mode: generates 1 sheet and returns it.");
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.query.qty || "10");
    const rotateAngle = parseInt(req.query.rotate || "0");

    const uploadedPDF = req.file.buffer;

    // ✅ Create a blank doc to host the sheet
    const gangDoc = await PDFDocument.create();
    const srcDoc = await PDFDocument.load(uploadedPDF);

    // ✅ Embed properly like before (copy the first page)
    const [embeddedPage] = await gangDoc.embedPdf(await srcDoc.save());

    let originalWidth = embeddedPage.width;
    let originalHeight = embeddedPage.height;

    const isRotated = rotateAngle === 90 || rotateAngle === 270;
    const logoWidthPts = isRotated ? originalHeight : originalWidth;
    const logoHeightPts = isRotated ? originalWidth : originalHeight;

    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const maxSheetHeightPts = MAX_SHEET_HEIGHT_INCH * POINTS_PER_INCH;
    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const usableWidth = sheetWidthPts - marginPts * 2;
    const perRow = Math.floor((usableWidth + spacingPts) / (logoWidthPts + spacingPts));

    // ✅ Calculate how many rows needed for just ONE sheet
    const maxPossibleRows = Math.floor(
      (maxSheetHeightPts - marginPts * 2 + spacingPts) / (logoHeightPts + spacingPts)
    );

    const rowsNeededForRemaining = Math.ceil(qty / perRow);
    const rowsForThisSheet = Math.min(rowsNeededForRemaining, maxPossibleRows);

    let requiredHeightPts =
      marginPts * 2 +
      rowsForThisSheet * logoHeightPts +
      (rowsForThisSheet - 1) * spacingPts;

    let rawInches = requiredHeightPts / POINTS_PER_INCH;
    let roundedHeightInches = Math.ceil(rawInches);
    if (roundedHeightInches > MAX_SHEET_HEIGHT_INCH) {
      roundedHeightInches = MAX_SHEET_HEIGHT_INCH;
    }
    const sheetHeightPts = roundedHeightInches * POINTS_PER_INCH;

    console.log(`📏 Sheet: ${rawInches.toFixed(2)}" → rounded ${roundedHeightInches}"`);

    const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);

    let remaining = qty;
    let placed = 0;
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
        placed++;
      }
    }

    console.log(`✅ Placed ${placed} logos on this sheet`);

    const firstSheetBuffer = await gangDoc.save();
    const filename = `gangsheet_${SHEET_WIDTH_INCH}x${roundedHeightInches}.pdf`;

    // ✅ Return as correct binary response
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Length", firstSheetBuffer.length);
    res.end(Buffer.from(firstSheetBuffer));

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error generating test sheet");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Test server running on port ${PORT}`));

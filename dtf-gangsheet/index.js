import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const SHEET_WIDTH_INCH = 22;
const MAX_SHEET_HEIGHT_INCH = 200;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;
const POINTS_PER_INCH = 72;

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile("test.html", { root: "." });
});

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const qty = parseInt(req.body.qty || "1");
    const rotate = req.body.rotate === "yes";

    const uploadedPDF = req.file.buffer;

    const srcDoc = await PDFDocument.load(uploadedPDF);
    const srcPage = srcDoc.getPages()[0];
    const srcWidth = srcPage.getWidth();
    const srcHeight = srcPage.getHeight();

    const logoWidthInch = rotate ? srcHeight / POINTS_PER_INCH : srcWidth / POINTS_PER_INCH;
    const logoHeightInch = rotate ? srcWidth / POINTS_PER_INCH : srcHeight / POINTS_PER_INCH;

    const usableWidth = SHEET_WIDTH_INCH - SAFE_MARGIN_INCH * 2;
    const usableHeight = MAX_SHEET_HEIGHT_INCH - SAFE_MARGIN_INCH * 2;

    const perRow = Math.max(1, Math.floor((usableWidth + SPACING_INCH) / (logoWidthInch + SPACING_INCH)));
    const perColMax = Math.max(1, Math.floor((usableHeight + SPACING_INCH) / (logoHeightInch + SPACING_INCH)));

    const perFullSheet = perRow * perColMax;

    console.log(`🧮 Each 22x200 sheet fits ${perRow} across x ${perColMax} down = ${perFullSheet}`);

    let logosToPlace = qty;

    // if we can fill a full 22x200 sheet
    let sheetHeightInch;
    if (logosToPlace >= perFullSheet) {
      logosToPlace = perFullSheet;
      sheetHeightInch = MAX_SHEET_HEIGHT_INCH;
    } else {
      // leftover height
      const rowsNeeded = Math.ceil(logosToPlace / perRow);
      let requiredHeightInch = rowsNeeded * (logoHeightInch + SPACING_INCH) + SAFE_MARGIN_INCH * 2;

      // ✅ always at least height of ONE full logo row
      const minHeightNeeded = logoHeightInch + SAFE_MARGIN_INCH * 2;
      if (requiredHeightInch < minHeightNeeded) {
        requiredHeightInch = minHeightNeeded;
      }

      sheetHeightInch = Math.min(Math.ceil(requiredHeightInch), MAX_SHEET_HEIGHT_INCH);
    }

    // ✅ Create only ONE sheet for now
    const gangDoc = await PDFDocument.create();
    const sheetWidthPts = SHEET_WIDTH_INCH * POINTS_PER_INCH;
    const sheetHeightPts = sheetHeightInch * POINTS_PER_INCH;
    const gangPage = gangDoc.addPage([sheetWidthPts, sheetHeightPts]);
    const [embeddedPage] = await gangDoc.embedPdf(await srcDoc.save());

    const marginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;
    const logoWidthPts = logoWidthInch * POINTS_PER_INCH;
    const logoHeightPts = logoHeightInch * POINTS_PER_INCH;

    let placed = 0;
    const maxCols = perRow;
    const maxRows = Math.ceil(sheetHeightInch / (logoHeightInch + SPACING_INCH));

    for (let row = 0; row < maxRows && placed < logosToPlace; row++) {
      for (let col = 0; col < maxCols && placed < logosToPlace; col++) {
        const baseX = marginPts + col * (logoWidthPts + spacingPts);
        const baseY = sheetHeightPts - marginPts - (row + 1) * logoHeightPts - row * spacingPts;

        gangPage.drawPage(embeddedPage, {
          x: rotate ? baseX + logoWidthPts : baseX,
          y: baseY,
          width: srcWidth,
          height: srcHeight,
          rotate: rotate ? degrees(90) : degrees(0),
        });

        placed++;
      }
    }

    console.log(`✅ Placed ${placed} logos on 22x${sheetHeightInch}`);

    const finalPDF = await gangDoc.save();
    const filename = `gangsheet_22x${sheetHeightInch}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(finalPDF);

  } catch (err) {
    console.error("❌ MERGE ERROR:", err);
    res.status(500).send("❌ Error generating gang sheet");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

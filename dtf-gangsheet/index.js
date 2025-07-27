import express from "express";
import multer from "multer";
import { PDFDocument } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

app.use(express.static("public"));

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

const COST_TABLE = {
  12: 5.28, 24: 10.56, 36: 15.84, 48: 21.12,
  60: 26.40, 80: 35.20, 100: 44.00, 120: 49.28,
  140: 56.32, 160: 61.60, 180: 68.64, 200: 75.68
};

function calculateCost(widthInches, heightInches) {
  const roundedHeight = Math.ceil(heightInches / 12) * 12;
  if (COST_TABLE[roundedHeight]) return COST_TABLE[roundedHeight];

  const tiers = Object.keys(COST_TABLE).map(Number).sort((a, b) => a - b);
  const nextTier = tiers.find((t) => t >= roundedHeight) || Math.max(...tiers);
  return COST_TABLE[nextTier];
}

app.post("/merge", upload.array("files"), async (req, res) => {
  try {
    log("/merge route hit!");

    const quantity = parseInt(req.body.quantity, 10);
    const rotate = req.body.rotate === "true";
    const gangWidth = parseInt(req.body.gangWidth, 10);
    const maxLengthInches = parseInt(req.body.maxLength, 10) || 200;

    const uploadedFiles = req.files;
    if (!uploadedFiles || uploadedFiles.length === 0) throw new Error("No files uploaded");
    if (!quantity || quantity <= 0) throw new Error("Invalid quantity");

    log(`Requested quantity per file: ${quantity}, rotate: ${rotate}`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLengthInches} inches`);
    log(`Total uploaded PDFs: ${uploadedFiles.length}`);

    const sheetWidthPts = gangWidth * POINTS_PER_INCH;
    const maxHeightPts = maxLengthInches * POINTS_PER_INCH;
    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    // ✅ Preload each uploaded PDF as a template with its first page size
    const allDesigns = [];
    for (const file of uploadedFiles) {
      const pdfDoc = await PDFDocument.load(file.buffer);
      const firstPage = pdfDoc.getPages()[0];
      let { width: designW, height: designH } = firstPage.getSize();

      if (rotate) [designW, designH] = [designH, designW];

      allDesigns.push({
        buffer: file.buffer,
        width: designW,
        height: designH,
        filename: file.originalname,
      });
    }

    // ✅ Build printQueue: N copies of each design
    let printQueue = [];
    for (const design of allDesigns) {
      for (let i = 0; i < quantity; i++) {
        printQueue.push(design);
      }
    }
    log(`Total designs to place: ${printQueue.length}`);

    let allSheetData = [];
    let queueIndex = 0;

    while (queueIndex < printQueue.length) {
      const sheetDoc = await PDFDocument.create();

      // ✅ Reset placement state for each new sheet
      let yCursor = maxHeightPts - safeMarginPts;
      let rowHeight = 0;
      let xCursor = safeMarginPts;
      let lowestY = maxHeightPts;
      let designsPlaced = 0;

      const page = sheetDoc.addPage([sheetWidthPts, maxHeightPts]);

      const remainingBefore = printQueue.length - queueIndex;
      log(`\n=== NEW SHEET START ===`);
      log(`Remaining before placement: ${remainingBefore}`);
      log(`Initial yCursor: ${yCursor}, lowestY: ${lowestY}`);

      while (queueIndex < printQueue.length) {
        const d = printQueue[queueIndex];
        const dTotalWidth = d.width + spacingPts;

        // ✅ Wrap row if needed
        if (xCursor + d.width > sheetWidthPts - safeMarginPts) {
          xCursor = safeMarginPts;
          yCursor -= (rowHeight + spacingPts);
          rowHeight = 0;
          log(`Row wrapped → new yCursor: ${yCursor}`);
        }

        // ✅ Stop if no vertical space left
        if (yCursor - d.height < safeMarginPts) {
          log(`Not enough vertical space for ${d.filename}, breaking…`);
          break;
        }

        // ✅ EMBED FRESH AS XOBJECT FOR THIS SHEET
        const [xObjectPage] = await sheetDoc.embedPdf(d.buffer);

        // ✅ Draw it at correct position
        page.drawPage(xObjectPage, {
          x: xCursor,
          y: yCursor - d.height,
        });

        log(
          `Placed ${d.filename} at X:${xCursor.toFixed(1)} Y:${(yCursor - d.height).toFixed(
            1
          )} (H:${d.height.toFixed(1)})`
        );

        designsPlaced++;
        if (d.height > rowHeight) rowHeight = d.height;

        const designBottomY = yCursor - d.height;
        if (designBottomY < lowestY) lowestY = designBottomY;

        xCursor += dTotalWidth;
        queueIndex++;
      }

      const remainingAfter = printQueue.length - queueIndex;
      log(`Placed ${designsPlaced} designs this sheet → ${remainingAfter} left`);

      if (designsPlaced === 0) {
        log(`⚠ No designs placed → stopping leftover blank sheet`);
        break;
      }

      // ✅ Calculate used height
      let usedHeightInches = (maxHeightPts - lowestY + safeMarginPts) / POINTS_PER_INCH;

      // ✅ Clamp used height
      if (usedHeightInches > maxLengthInches) {
        usedHeightInches = maxLengthInches;
      }

      // ✅ Round UP to next 12"
      const roundedHeightInches = Math.ceil(usedHeightInches / 12) * 12;
      const finalHeightInches = Math.min(roundedHeightInches, maxLengthInches);

      // ✅ Resize page
      const finalHeightPts = finalHeightInches * POINTS_PER_INCH;
      page.setSize(sheetWidthPts, finalHeightPts);

      const cost = calculateCost(gangWidth, finalHeightInches);
      const pdfBytes = await sheetDoc.save();
      const filename = `gangsheet_${gangWidth}x${finalHeightInches}.pdf`;

      allSheetData.push({
        filename,
        buffer: Buffer.from(pdfBytes),
        width: gangWidth,
        height: finalHeightInches,
        cost,
      });

      log(
        `✅ Generated sheet ${filename} with ${designsPlaced} designs → used ~${usedHeightInches.toFixed(
          1
        )}” rounded to ${finalHeightInches}”`
      );
    }

    const totalCost = allSheetData.reduce((sum, s) => sum + s.cost, 0);

    res.json({
      sheets: allSheetData.map((s) => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64"),
      })),
      totalCost,
    });
  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

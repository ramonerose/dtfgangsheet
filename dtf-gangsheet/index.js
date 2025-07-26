import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 8080;

// Constants
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

app.use(express.static("public"));

function log(msg) {
  console.log(`[DEBUG] ${msg}`);
}

// ✅ Cost table
const COST_TABLE = {
  12: 5.28, 24: 10.56, 36: 15.84, 48: 21.12,
  60: 26.40, 80: 35.20, 100: 44.00, 120: 49.28,
  140: 56.32, 160: 61.60, 180: 68.64, 200: 75.68
};

// ✅ Cost rounding logic
function calculateCost(widthInches, heightInches) {
  const roundedHeight = Math.ceil(heightInches / 12) * 12;
  if (COST_TABLE[roundedHeight]) return COST_TABLE[roundedHeight];

  const tiers = Object.keys(COST_TABLE).map(Number).sort((a,b) => a-b);
  const nextTier = tiers.find(t => t >= roundedHeight) || Math.max(...tiers);
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

    // ✅ Load all uploaded PDFs, store their pages as "designs"
    const allDesigns = [];
    for (const file of uploadedFiles) {
      const pdfDoc = await PDFDocument.load(file.buffer);
      const page = pdfDoc.getPages()[0];
      let { width: designW, height: designH } = page.getSize();

      if (rotate) [designW, designH] = [designH, designW];

      allDesigns.push({
        buffer: file.buffer,
        width: designW,
        height: designH,
        filename: file.originalname
      });
    }

    // ✅ Build a "print list" with N copies of each design
    let printQueue = [];
    for (const design of allDesigns) {
      for (let i = 0; i < quantity; i++) {
        printQueue.push(design);
      }
    }
    log(`Total designs to place: ${printQueue.length}`);

    // ✅ Now we’ll generate sheets
    let allSheetData = [];
    let queueIndex = 0;

    while (queueIndex < printQueue.length) {
      // For each new sheet
      const sheetDoc = await PDFDocument.create();

      // Embed all unique designs once for this sheet
      const embeddedCache = {};
      for (let d of allDesigns) {
        const [embeddedPage] = await sheetDoc.embedPdf(d.buffer);
        embeddedCache[d.filename] = embeddedPage;
      }

      let yCursor = maxHeightPts - safeMarginPts;
      let usedHeightPts = safeMarginPts; // bottom margin

      const page = sheetDoc.addPage([sheetWidthPts, maxHeightPts]);
      let rowHeight = 0;

      let xCursor = safeMarginPts;

      while (queueIndex < printQueue.length) {
        const d = printQueue[queueIndex];
        const dTotalWidth = d.width + spacingPts;
        const dTotalHeight = d.height + spacingPts;

        // If this design is too wide for remaining row space -> go new row
        if (xCursor + d.width > sheetWidthPts - safeMarginPts) {
          xCursor = safeMarginPts;
          yCursor -= (rowHeight + spacingPts);
          rowHeight = 0;
        }

        // If no more vertical space -> sheet full
        if (yCursor - d.height < safeMarginPts) break;

        // Draw design
        page.drawPage(embeddedCache[d.filename], { x: xCursor, y: yCursor - d.height });

        // Track row height
        if (d.height > rowHeight) rowHeight = d.height;

        // Move cursor to next column
        xCursor += dTotalWidth;

        // Count it placed
        queueIndex++;
      }

      // Calculate actual used height for pricing
      const usedHeightPtsThisSheet = maxHeightPts - yCursor + safeMarginPts;
      const roundedHeightPts = Math.ceil(usedHeightPtsThisSheet / POINTS_PER_INCH) * POINTS_PER_INCH;
      const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);
      const cost = calculateCost(gangWidth, finalHeightInch);

      const pdfBytes = await sheetDoc.save();
      const filename = `gangsheet_${gangWidth}x${finalHeightInch}.pdf`;

      allSheetData.push({
        filename,
        buffer: Buffer.from(pdfBytes),
        width: gangWidth,
        height: finalHeightInch,
        cost
      });

      log(`Generated sheet with ${queueIndex} designs so far`);
    }

    const totalCost = allSheetData.reduce((sum, s) => sum + s.cost, 0);

    res.json({
      sheets: allSheetData.map(s => ({
        filename: s.filename,
        width: s.width,
        height: s.height,
        cost: s.cost,
        pdfBase64: s.buffer.toString("base64")
      })),
      totalCost
    });

  } catch (err) {
    console.error("MERGE ERROR:", err);
    res.status(500).send(`Server error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

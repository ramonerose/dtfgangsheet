import express from "express";
import multer from "multer";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs";
import path from "path";
import PDFMerger from "pdf-lib"; // we'll use pdf-lib
import { PDFDocument } from "pdf-lib";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // For serving the HTML frontend

// ✅ File Upload Handling
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ✅ Constants
const DPI = 300;                // Standard PDF DPI
const INCH_TO_POINTS = 72;      // PDF units (points)
const SPACING_INCH = 0.25;      // 1/4 inch spacing
const SPACING_POINTS = SPACING_INCH * INCH_TO_POINTS;

// ✅ Cost tiers for pricing
const COST_TABLE = [
  { length: 12, cost: 5.28 },
  { length: 24, cost: 10.56 },
  { length: 36, cost: 15.84 },
  { length: 48, cost: 21.12 },
  { length: 60, cost: 26.40 },
  { length: 80, cost: 35.20 },
  { length: 100, cost: 44.00 },
  { length: 120, cost: 49.28 },
  { length: 140, cost: 56.32 },
  { length: 160, cost: 61.60 },
  { length: 180, cost: 68.64 },
  { length: 200, cost: 75.68 }
];

// ✅ Helper: Round up to next pricing tier
function getCostForLength(length) {
  for (let tier of COST_TABLE) {
    if (length <= tier.length) return tier.cost;
  }
  return COST_TABLE[COST_TABLE.length - 1].cost; // Max cost fallback
}

// ✅ POST /merge → Main logic
app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    const quantity = parseInt(req.body.quantity) || 1;
    const rotate = req.body.rotate === "true";
    const gangWidthInches = parseFloat(req.body.gangWidth) || 22;
    const maxLengthInches = parseFloat(req.body.maxLength) || 200;

    const gangWidthPoints = gangWidthInches * INCH_TO_POINTS;
    const maxLengthPoints = maxLengthInches * INCH_TO_POINTS;

    console.log("=== GANG SHEET REQUEST ===");
    console.log(`Quantity: ${quantity}, Rotate: ${rotate}`);
    console.log(`Width: ${gangWidthInches}in → ${gangWidthPoints}pts, Max Length: ${maxLengthInches}in → ${maxLengthPoints}pts`);

    // ✅ Load uploaded PDF
    const uploadedPdf = await PDFDocument.load(req.file.buffer);
    const firstPage = uploadedPdf.getPages()[0];
    let { width: artWidthPts, height: artHeightPts } = firstPage.getSize();

    // ✅ Rotate if requested
    if (rotate) [artWidthPts, artHeightPts] = [artHeightPts, artWidthPts];

    // ✅ Scale art to fit width
    const scaleFactor = gangWidthPoints / artWidthPts;
    const scaledArtWidth = gangWidthPoints;
    const scaledArtHeight = artHeightPts * scaleFactor;

    console.log(`Scaled Art → ${scaledArtWidth} x ${scaledArtHeight}`);

    // ✅ Track results
    let remaining = quantity;
    let sheets = [];
    let totalCost = 0;

    while (remaining > 0) {
      const sheetPdf = await PDFDocument.create();
      const sheetPage = sheetPdf.addPage([gangWidthPoints, maxLengthPoints]);

      let xCursor = 9;  // small left padding
      let yCursor = maxLengthPoints - scaledArtHeight - 9;

      let fitsOnSheet = 0;

      while (remaining > 0) {
        // Place design
        const [embeddedPage] = await sheetPdf.copyPages(uploadedPdf, [0]);
        sheetPage.drawPage(embeddedPage, {
          x: xCursor,
          y: yCursor,
          width: scaledArtWidth,
          height: scaledArtHeight
        });

        remaining--;
        fitsOnSheet++;

        // ✅ Move X cursor for next placement
        xCursor += scaledArtWidth + SPACING_POINTS;

        // ✅ If next art exceeds width, wrap to next row
        if (xCursor + scaledArtWidth > gangWidthPoints) {
          xCursor = 9;
          yCursor -= (scaledArtHeight + SPACING_POINTS);
        }

        // ✅ If next art exceeds height, stop this sheet
        if (yCursor < 0) break;
      }

      // ✅ Calculate used height
      const rowsUsed = Math.ceil(fitsOnSheet / Math.floor(gangWidthPoints / (scaledArtWidth + SPACING_POINTS)));
      const usedHeightPoints = rowsUsed * (scaledArtHeight + SPACING_POINTS);
      let usedInches = Math.ceil(usedHeightPoints / INCH_TO_POINTS);

      // ✅ Always round UP to nearest 12"
      let roundedSheetLength = Math.ceil(usedInches / 12) * 12;
      if (roundedSheetLength > maxLengthInches) roundedSheetLength = maxLengthInches;

      console.log(`→ Sheet fits ${fitsOnSheet}, used ${usedInches}" → rounded ${roundedSheetLength}"`);

      // ✅ Resize the page
      sheetPage.setSize(gangWidthPoints, roundedSheetLength * INCH_TO_POINTS);

      // ✅ Get PDF bytes
      const sheetBytes = await sheetPdf.save();

      // ✅ Price
      const cost = getCostForLength(roundedSheetLength);
      totalCost += cost;

      // ✅ Store result
      sheets.push({
        filename: `gangsheet_${gangWidthInches}x${roundedSheetLength}.pdf`,
        cost,
        pdfBase64: Buffer.from(sheetBytes).toString("base64")
      });
    }

    res.json({
      sheets,
      totalCost
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Failed to generate gang sheets" });
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});

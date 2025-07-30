import express from "express";
import multer from "multer";
import { PDFDocument, degrees } from "pdf-lib";
import sharp from "sharp";
import cors from "cors";
import helmet from "helmet";

const app = express();
const PORT = process.env.PORT || 8080;

// Enhanced security and middleware
app.use(helmet());
app.use(cors());
app.use(express.static("public"));

// Improved file upload configuration with limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and PNG/JPEG files are allowed.'), false);
    }
  }
});

// Constants
const POINTS_PER_INCH = 72;
const SAFE_MARGIN_INCH = 0.125;
const SPACING_INCH = 0.5;

// Enhanced cost table with better validation
const COST_TABLE = {
  12: 5.28,
  24: 10.56,
  36: 15.84,
  48: 21.12,
  60: 26.40,
  80: 35.20,
  100: 44.00,
  120: 49.28,
  140: 56.32,
  160: 61.60,
  180: 68.64,
  200: 75.68
};

function log(msg) {
  console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`);
}

// Enhanced cost calculation with better error handling
function calculateCost(widthInches, heightInches) {
  try {
    if (!widthInches || !heightInches || widthInches <= 0 || heightInches <= 0) {
      throw new Error('Invalid dimensions for cost calculation');
    }

    // Round UP to the next 12-inch increment
    const roundedHeight = Math.ceil(heightInches / 12) * 12;

    // If exact tier exists, return it
    if (COST_TABLE[roundedHeight]) {
      return COST_TABLE[roundedHeight];
    }

    // Otherwise find the NEXT available tier (round up to next in table)
    const availableTiers = Object.keys(COST_TABLE).map(Number).sort((a, b) => a - b);
    const nextTier = availableTiers.find(t => t >= roundedHeight) || Math.max(...availableTiers);

    return COST_TABLE[nextTier];
  } catch (error) {
    log(`Cost calculation error: ${error.message}`);
    return 0; // Return 0 cost if calculation fails
  }
}

// New function to convert PNG to PDF
async function convertImageToPDF(imageBuffer, mimeType) {
  try {
    let processedImage;
    
    if (mimeType.startsWith('image/')) {
      // Process image with sharp
      processedImage = await sharp(imageBuffer)
        .png() // Convert to PNG for consistency
        .toBuffer();
    } else {
      throw new Error('Unsupported image format');
    }

    // Create PDF with the image
    const pdfDoc = await PDFDocument.create();
    const image = await pdfDoc.embedPng(processedImage);
    
    const { width, height } = image.scale(1);
    const page = pdfDoc.addPage([width, height]);
    
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: width,
      height: height,
    });

    return await pdfDoc.save();
  } catch (error) {
    log(`Image to PDF conversion error: ${error.message}`);
    throw new Error(`Failed to convert image to PDF: ${error.message}`);
  }
}

// Enhanced input validation
function validateInputs(req) {
  const errors = [];
  
  if (!req.file) {
    errors.push('No file uploaded');
  }
  
  const quantity = parseInt(req.body.quantity, 10);
  if (!quantity || quantity <= 0 || quantity > 10000) {
    errors.push('Invalid quantity (must be 1-10000)');
  }
  
  const gangWidth = parseInt(req.body.gangWidth, 10);
  if (![22, 30].includes(gangWidth)) {
    errors.push('Invalid gang width (must be 22 or 30)');
  }
  
  const maxLength = parseInt(req.body.maxLength, 10);
  if (!maxLength || maxLength < 12 || maxLength > 200) {
    errors.push('Invalid max length (must be 12-200 inches)');
  }
  
  return { errors, quantity, gangWidth, maxLength };
}

app.post("/merge", upload.single("file"), async (req, res) => {
  try {
    log("/merge route hit!");

    // Enhanced input validation
    const { errors, quantity, gangWidth, maxLength } = validateInputs(req);
    if (errors.length > 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.join(', ') 
      });
    }

    const rotate = req.body.rotate === "true";
    const uploadedFile = req.file;

    log(`Requested quantity: ${quantity}, rotate: ${rotate}`);
    log(`Selected gang width: ${gangWidth} inches`);
    log(`Max sheet length: ${maxLength} inches`);
    log(`Uploaded file: ${uploadedFile.originalname} (${uploadedFile.mimetype})`);

    let pdfBuffer;
    
    // Handle different file types
    if (uploadedFile.mimetype === 'application/pdf') {
      pdfBuffer = uploadedFile.buffer;
    } else if (uploadedFile.mimetype.startsWith('image/')) {
      log('Converting image to PDF...');
      pdfBuffer = await convertImageToPDF(uploadedFile.buffer, uploadedFile.mimetype);
    } else {
      throw new Error('Unsupported file type');
    }

    // Load PDF with error handling
    let uploadedPdf;
    try {
      uploadedPdf = await PDFDocument.load(pdfBuffer);
    } catch (error) {
      throw new Error(`Failed to load PDF: ${error.message}`);
    }

    const pages = uploadedPdf.getPages();
    if (pages.length === 0) {
      throw new Error('PDF has no pages');
    }

    const uploadedPage = pages[0];
    let { width: logoWidth, height: logoHeight } = uploadedPage.getSize();

    // Validate logo dimensions
    if (logoWidth <= 0 || logoHeight <= 0) {
      throw new Error('Invalid logo dimensions');
    }

    let layoutWidth = logoWidth;
    let layoutHeight = logoHeight;
    if (rotate) [layoutWidth, layoutHeight] = [logoHeight, logoWidth];

    const safeMarginPts = SAFE_MARGIN_INCH * POINTS_PER_INCH;
    const spacingPts = SPACING_INCH * POINTS_PER_INCH;

    const sheetWidthPts = gangWidth * POINTS_PER_INCH;
    const maxHeightPts = maxLength * POINTS_PER_INCH;

    const logoTotalWidth = layoutWidth + spacingPts;
    const logoTotalHeight = layoutHeight + spacingPts;

    const logosPerRow = Math.floor(
      (sheetWidthPts - safeMarginPts * 2 + spacingPts) / logoTotalWidth
    );
    
    if (logosPerRow < 1) {
      throw new Error(`Logo too wide for sheet. Logo width: ${(layoutWidth / POINTS_PER_INCH).toFixed(2)} inches, Sheet width: ${gangWidth} inches`);
    }
    
    log(`Can fit ${logosPerRow} logos per row`);

    const rowsPerSheet = Math.floor(
      (maxHeightPts - safeMarginPts * 2 + spacingPts) / logoTotalHeight
    );
    
    if (rowsPerSheet < 1) {
      throw new Error(`Logo too tall for sheet. Logo height: ${(layoutHeight / POINTS_PER_INCH).toFixed(2)} inches, Max sheet height: ${maxLength} inches`);
    }
    
    const logosPerSheet = logosPerRow * rowsPerSheet;

    log(`Each sheet max ${rowsPerSheet} rows → ${logosPerSheet} logos per sheet`);

    const totalSheetsNeeded = Math.ceil(quantity / logosPerSheet);
    log(`Total sheets needed: ${totalSheetsNeeded}`);

    const drawLogo = (page, embeddedPage, x, y) => {
      try {
        if (rotate) {
          page.drawPage(embeddedPage, {
            x: x + logoHeight,
            y,
            rotate: degrees(90)
          });
        } else {
          page.drawPage(embeddedPage, { x, y });
        }
      } catch (error) {
        log(`Error drawing logo at (${x}, ${y}): ${error.message}`);
        throw error;
      }
    };

    let allSheetData = [];
    let remaining = quantity;

    for (let sheetIndex = 0; sheetIndex < totalSheetsNeeded; sheetIndex++) {
      try {
        const sheetDoc = await PDFDocument.create();
        const [embeddedPage] = await sheetDoc.embedPdf(pdfBuffer);

        const logosOnThisSheet = Math.min(remaining, logosPerSheet);
        const usedRows = Math.ceil(logosOnThisSheet / logosPerRow);
        const usedHeightPts =
          usedRows * logoTotalHeight + safeMarginPts * 2 - spacingPts;
        const roundedHeightPts =
          Math.ceil(usedHeightPts / POINTS_PER_INCH) * POINTS_PER_INCH;

        const page = sheetDoc.addPage([sheetWidthPts, roundedHeightPts]);

        let yCursor = roundedHeightPts - safeMarginPts - layoutHeight;
        let drawn = 0;

        while (drawn < logosOnThisSheet) {
          let xCursor = safeMarginPts;
          for (let c = 0; c < logosPerRow && drawn < logosOnThisSheet; c++) {
            drawLogo(page, embeddedPage, xCursor, yCursor);
            drawn++;
            remaining--;
            xCursor += logoTotalWidth;
          }
          yCursor -= logoTotalHeight;
        }

        const pdfBytes = await sheetDoc.save();
        const finalHeightInch = Math.ceil(roundedHeightPts / POINTS_PER_INCH);

        const cost = calculateCost(gangWidth, finalHeightInch);

        const filename = `gangsheet_${gangWidth}x${finalHeightInch}_sheet${sheetIndex + 1}.pdf`;
        allSheetData.push({
          filename,
          buffer: Buffer.from(pdfBytes),
          width: gangWidth,
          height: finalHeightInch,
          cost
        });

        log(`Generated sheet ${sheetIndex + 1}: ${filename} (${finalHeightInch} inches, $${cost})`);
      } catch (error) {
        log(`Error generating sheet ${sheetIndex + 1}: ${error.message}`);
        throw new Error(`Failed to generate sheet ${sheetIndex + 1}: ${error.message}`);
      }
    }

    const totalCost = allSheetData.reduce((sum, s) => sum + s.cost, 0);

    log(`Successfully generated ${allSheetData.length} sheets with total cost: $${totalCost}`);

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
    log(`MERGE ERROR: ${err.message}`);
    console.error("Full error:", err);
    
    // Send appropriate error response
    const statusCode = err.message.includes('Validation') ? 400 : 500;
    res.status(statusCode).json({ 
      error: 'Processing failed', 
      message: err.message 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  log(`Backend running on port ${PORT}`);
  log(`Health check available at http://localhost:${PORT}/health`);
});

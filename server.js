
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const session = require("express-session");

const app = express();
const PORT = 3000;

const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(publicDir, "uploads");
const dataFile = path.join(__dirname, "products.json");

// Required folders and data file
fs.mkdirSync(uploadsDir, { recursive: true });

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, "[]", "utf8");
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "nayab-local-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use(express.static(publicDir));

function readProducts() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return [];
  }
}

function saveProducts(products) {
  fs.writeFileSync(dataFile, JSON.stringify(products, null, 2), "utf8");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("केवल इमेज फ़ाइल अपलोड करें।"));
    }
  }
});

// Customer: get all products
app.get("/api/products", (req, res) => {
  res.json(readProducts());
});

// Admin login
app.post("/api/login", (req, res) => {
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    return res.status(500).json({
      error: "Admin password सेट नहीं है।"
    });
  }

  if (req.body.password !== password) {
    return res.status(401).json({
      error: "गलत पासवर्ड।"
    });
  }

  req.session.isAdmin = true;
  res.json({ success: true });
});

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();

  return res.status(401).json({
    error: "पहले Admin Login करें।"
  });
}

// Admin: add a product with an image
app.post(
  "/api/admin/products",
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    const name = (req.body.name || "").trim();
    const category = (req.body.category || "").trim();
    const price = Number(req.body.price);

    if (
      !name ||
      !category ||
      req.body.price === undefined ||
      req.body.price === "" ||
      !Number.isFinite(price) ||
      price < 0 ||
      !req.file
    ) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(400).json({
        error: "नाम, सही कीमत, कैटेगरी और इमेज भरें।"
      });
    }

    const products = readProducts();

    const product = {
      id: Date.now().toString(),
      name,
      category,
      price,
      image: "/uploads/" + req.file.filename
    };

    products.push(product);
    saveProducts(products);

    res.status(201).json({
      success: true,
      product
    });
  }
);

// Admin: delete a product
app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const products = readProducts();
  const product = products.find((p) => p.id === req.params.id);

  if (!product) {
    return res.status(404).json({
      error: "प्रोडक्ट नहीं मिला।"
    });
  }

  const updatedProducts = products.filter(
    (p) => p.id !== req.params.id
  );

  saveProducts(updatedProducts);

  if (product.image && product.image.startsWith("/uploads/")) {
    const imagePath = path.join(
      uploadsDir,
      path.basename(product.image)
    );

    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }

  res.json({ success: true });
});

// Show clear upload errors
app.use((err, req, res, next) => {
  console.error(err.message);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "इमेज 5 MB से छोटी होनी चाहिए।"
          : err.message
    });
  }

  res.status(400).json({
    error: err.message || "कुछ गलत हुआ।"
  });
});

app.listen(PORT, () => {
  console.log("Nayab Cosmetic: http://localhost:" + PORT);
  console.log("Admin Panel: http://localhost:" + PORT + "/admin.html");
});


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

app.post("/api/orders", async (req, res) => {
  try {
    const { customer, items } = req.body;

    if (
      !customer ||
      typeof customer.name !== "string" ||
      !customer.name.trim() ||
      typeof customer.phone !== "string" ||
      !/^[0-9+\-\s()]{10,18}$/.test(customer.phone.trim()) ||
      typeof customer.address !== "string" ||
      !customer.address.trim() ||
      customer.address.trim().length < 5
    ) {
      return res.status(400).json({
        error: "Sahi naam, mobile number aur delivery address bharein."
      });
    }

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 30
    ) {
      return res.status(400).json({
        error: "Cart mein valid products add karein."
      });
    }

    const productsPath = path.join(__dirname, "products.json");
    const ordersPath = path.join(__dirname, "orders.json");

    const products = JSON.parse(
      await fs.promises.readFile(productsPath, "utf8")
    );

    let orders = [];

    try {
      orders = JSON.parse(
        await fs.promises.readFile(ordersPath, "utf8")
      );
      if (!Array.isArray(orders)) orders = [];
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const orderItems = [];
    const seenIds = new Set();

    for (const item of items) {
      const id = String(item.id || "");
      const qty = Number(item.quantity);

      if (
        !id ||
        seenIds.has(id) ||
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 20
      ) {
        return res.status(400).json({
          error: "Product ya quantity sahi nahi hai."
        });
      }

      seenIds.add(id);

      const product = products.find(
        p => String(p.id) === id
      );

      if (!product) {
        return res.status(400).json({
          error: "Cart mein ek product ab available nahi hai."
        });
      }

      const price = Number(product.price);

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          error: "Product ki price sahi nahi hai."
        });
      }

      orderItems.push({
        productId: String(product.id),
        name: String(product.name),
        price,
        quantity: qty,
        subtotal: price * qty
      });
    }

    const total = orderItems.reduce(
      (sum, item) => sum + item.subtotal,
      0
    );

    const order = {
      id: Date.now().toString() +
          Math.random().toString(36).slice(2, 7),
      customer: {
        name: customer.name.trim().slice(0, 100),
        phone: customer.phone.trim(),
        address: customer.address.trim().slice(0, 500)
      },
      items: orderItems,
      total,
      paymentMethod: "Cash on Delivery",
      deliveryMethod: "Home Delivery",
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    orders.push(order);

    await fs.promises.writeFile(
      ordersPath,
      JSON.stringify(orders, null, 2),
      "utf8"
    );

    return res.status(201).json({
      success: true,
      message: "Order place ho gaya!",
      orderId: order.id,
      total: order.total
    });
  } catch (error) {
    console.error("Order error:", error);
    return res.status(500).json({
      error: "Order save nahi ho saka. Dobara try karein."
    });
  }
});

app.listen(PORT, () => {
  console.log("Nayab Cosmetic: http://localhost:" + PORT);
  console.log("Admin Panel: http://localhost:" + PORT + "/admin.html");
});

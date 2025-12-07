const express = require("express");
const http = require("http");
const { Command } = require("commander");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const swaggerUi = require("swagger-ui-express");

// === 1. Налаштування аргументів командного рядка ===
const program = new Command();

program
  .helpOption("-H, --help", "Відобразити допомогу")
  .requiredOption("-h, --host <host>", "Адреса сервера")
  .requiredOption("-p, --port <port>", "Порт сервера")
  .requiredOption("-c, --cache <path>", "Шлях до директорії кешу");

program.parse(process.argv);
const options = program.opts();

// === 2. Створення папки кешу ===
const cacheDir = path.resolve(options.cache);
if (!fs.existsSync(cacheDir)) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log(`Створено директорію кешу: ${cacheDir}`);
  } catch (err) {
    console.error("Не вдалося створити папку:", err.message);
    process.exit(1); // Використовуємо exit, а не return!
  }
}

const app = express();

// === 3. Middleware ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Налаштування Multer (завантаження фото)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, cacheDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});
const upload = multer({ storage: storage });

// "База даних" у пам'яті
let inventory = [];

// === 4. Swagger (Документація) ===
const swaggerDocument = {
  openapi: "3.0.0",
  info: { title: "Inventory API", version: "1.0.0" },
  paths: {
    "/inventory": {
      get: {
        summary: "Отримати список",
        responses: { 200: { description: "OK" } },
      },
    },
    "/register": {
      post: {
        summary: "Реєстрація",
        responses: { 201: { description: "Created" } },
      },
    },
  },
};
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// === 5. Ендпоінти API ===

// POST /register
app.post("/register", upload.single("photo"), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name) {
    return res.status(400).send("Bad Request: inventory_name is required");
  }

  const newItem = {
    id: Date.now().toString(),
    name: inventory_name,
    description: description || "",
    photo: req.file ? req.file.filename : null,
  };

  inventory.push(newItem);
  res.status(201).send(`Item created with ID: ${newItem.id}`);
});

// GET /inventory
app.get("/inventory", (req, res) => {
  res.status(200).json(inventory);
});

// GET /inventory/:id
app.get("/inventory/:id", (req, res) => {
  const item = inventory.find((i) => i.id === req.params.id);
  if (!item) {
    return res.status(404).send("Not Found");
  }
  res.status(200).json(item);
});

// PUT /inventory/:id
app.put("/inventory/:id", (req, res) => {
  const item = inventory.find((i) => i.id === req.params.id);
  if (!item) {
    return res.status(404).send("Not Found");
  }

  if (req.body.name) item.name = req.body.name;
  if (req.body.description) item.description = req.body.description;

  res.status(200).json(item);
});

// GET /inventory/:id/photo
app.get("/inventory/:id/photo", (req, res) => {
  const item = inventory.find((i) => i.id === req.params.id);
  if (!item || !item.photo) {
    return res.status(404).send("Not Found");
  }

  const filePath = path.join(cacheDir, item.photo);
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "image/jpeg");
    res.sendFile(filePath);
  } else {
    res.status(404).send("Photo file missing");
  }
});

// PUT /inventory/:id/photo
app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const item = inventory.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).send("Not Found");

  if (req.file) {
    // Видалення старого фото (необов'язково, але бажано)
    if (item.photo) {
      try {
        fs.unlinkSync(path.join(cacheDir, item.photo));
      } catch (e) {}
    }
    item.photo = req.file.filename;
    res.status(200).send("Photo updated");
  } else {
    res.status(400).send("No file uploaded");
  }
});

// DELETE /inventory/:id
app.delete("/inventory/:id", (req, res) => {
  const index = inventory.findIndex((i) => i.id === req.params.id);
  if (index === -1) return res.status(404).send("Not Found");

  const item = inventory[index];
  if (item.photo) {
    try {
      fs.unlinkSync(path.join(cacheDir, item.photo));
    } catch (e) {}
  }

  inventory.splice(index, 1);
  res.status(200).send("Deleted");
});

// POST /search
app.post("/search", (req, res) => {
  const { id, includePhoto, has_photo } = req.body;
  // Обробка checkbox (може прийти як 'on', true, або рядок 'true')
  const needsPhoto =
    includePhoto === "on" || includePhoto === "true" || has_photo === "on";

  const item = inventory.find((i) => i.id === id);

  if (item) {
    let resultItem = { ...item };
    if (needsPhoto && item.photo) {
      resultItem.description += ` (Photo link: /inventory/${item.id}/photo)`;
    }
    res.status(200).json(resultItem);
  } else {
    res.status(404).send("Not Found");
  }
});

// === 6. HTML файли ===
app.get("/RegisterForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "RegisterForm.html"));
});

app.get("/SearchForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "SearchForm.html"));
});

// Обробка неправильних методів (405) або шляхів (404)
app.use((req, res) => {
  // Перевірка на 405 (якщо шлях правильний, але метод не той)
  if (req.path.includes("/inventory") || req.path.includes("/register")) {
    res.status(405).send("Method Not Allowed");
  } else {
    // Усі інші випадки - 404
    res.status(404).send("Page Not Found");
  }
});

// === 7. Запуск сервера ===
const server = http.createServer(app);

server.listen(options.port, options.host, () => {
  console.log(`Server is running at http://${options.host}:${options.port}`);
  console.log(`Swagger docs at http://${options.host}:${options.port}/docs`);
});

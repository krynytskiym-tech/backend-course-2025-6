const express = require('express');
const http = require('http');
const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');

[cite_start]// Ініціалізація Commander для аргументів CLI [cite: 36-40]
const program = new Command();

program
  .helpOption('-H, --help', 'Відобразити допомогу') // Звільняємо -h для хоста
  .requiredOption('-h, --host <host>', 'Адреса сервера')
  .requiredOption('-p, --port <port>', 'Порт сервера')
  .requiredOption('-c, --cache <path>', 'Шлях до директорії кешу');

program.parse(process.argv);
const options = program.opts();

[cite_start]// Створення директорії кешу, якщо не існує [cite: 41]
const cacheDir = path.resolve(options.cache);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log(`Створено директорію кешу: ${cacheDir}`);
}

const app = express();

// Middleware
app.use(express.json()); // Для JSON тіла
app.use(express.urlencoded({ extended: true })); [cite_start]// Для x-www-form-urlencoded (форми) [cite: 75]

[cite_start]// Налаштування Multer для завантаження фото [cite: 20, 21]
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, cacheDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

// "База даних" у пам'яті
let inventory = [];

[cite_start]// === SWAGGER ДОКУМЕНТАЦІЯ (Мінімальна конфігурація) [cite: 91] ===
const swaggerDocument = {
  openapi: '3.0.0',
  info: { title: 'Inventory API', version: '1.0.0' },
  paths: {
    '/inventory': {
      get: { summary: 'Отримати весь список', responses: { 200: { description: 'OK' } } }
    },
    '/register': {
      post: { summary: 'Реєстрація товару', responses: { 201: { description: 'Created' } } }
    }
  }
};
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));


// === ЕНДПОІНТИ ===

[cite_start]// 1. POST /register - Реєстрація товару [cite: 48]
app.post('/register', upload.single('photo'), (req, res) => {
    const { inventory_name, description } = req.body;

    if (!inventory_name) {
        [cite_start]return res.status(400).send('Bad Request: inventory_name is required'); // [cite: 48]
    }

    const newItem = {
        id: Date.now().toString(),
        name: inventory_name,
        description: description || '',
        photo: req.file ? req.file.filename : null
    };

    inventory.push(newItem);
    res.status(201).send(`Item created with ID: ${newItem.id}`); [cite_start]// [cite: 80]
});

[cite_start]// 2. GET /inventory - Отримання списку [cite: 48]
app.get('/inventory', (req, res) => {
    // Формуємо відповідь з повним шляхом до зображення (опціонально)
    const response = inventory.map(item => ({
        ...item,
        photoUrl: item.photo ? `/inventory/${item.id}/photo` : null
    }));
    res.status(200).json(response);
});

[cite_start]// 3. GET /inventory/:id - Отримання конкретної речі [cite: 48]
app.get('/inventory/:id', (req, res) => {
    const item = inventory.find(i => i.id === req.params.id);
    [cite_start]if (!item) return res.status(404).send('Not Found'); // [cite: 48]
    res.status(200).json(item);
});

[cite_start]// 4. PUT /inventory/:id - Оновлення імені або опису [cite: 48]
app.put('/inventory/:id', (req, res) => {
    const item = inventory.find(i => i.id === req.params.id);
    if (!item) return res.status(404).send('Not Found');

    if (req.body.name) item.name = req.body.name;
    if (req.body.description) item.description = req.body.description;

    res.status(200).json(item);
});

[cite_start]// 5. DELETE /inventory/:id - Видалення речі [cite: 57-59]
app.delete('/inventory/:id', (req, res) => {
    const index = inventory.findIndex(i => i.id === req.params.id);
    if (index === -1) return res.status(404).send('Not Found');

    // Опціонально: видалити файл фото з диска
    const item = inventory[index];
    if (item.photo) {
        fs.unlink(path.join(cacheDir, item.photo), (err) => {
            if (err) console.error('Не вдалося видалити файл:', err);
        });
    }

    inventory.splice(index, 1);
    res.status(200).send('Deleted');
});

[cite_start]// 6. GET /inventory/:id/photo - Отримання фото [cite: 48]
app.get('/inventory/:id/photo', (req, res) => {
    const item = inventory.find(i => i.id === req.params.id);
    [cite_start]if (!item || !item.photo) return res.status(404).send('Not Found'); // [cite: 48]

    const filePath = path.join(cacheDir, item.photo);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'image/jpeg'); [cite_start]// [cite: 82]
        res.sendFile(filePath);
    } else {
        res.status(404).send('Photo file not found on server');
    }
});

[cite_start]// 7. PUT /inventory/:id/photo - Оновлення фото [cite: 52]
app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
    const item = inventory.find(i => i.id === req.params.id);
    [cite_start]if (!item) return res.status(404).send('Not Found'); // [cite: 55]

    if (req.file) {
        // Видаляємо старе фото, якщо воно було
        if (item.photo) {
             fs.unlink(path.join(cacheDir, item.photo), () => {});
        }
        item.photo = req.file.filename;
        res.status(200).send('Photo updated');
    } else {
        res.status(400).send('No photo uploaded');
    }
});

[cite_start]// 8. POST /search - Пошук за ID [cite: 70-78]
app.post('/search', (req, res) => {
    // Отримуємо ID та checkbox (ім'я в html 'includePhoto', у завданні 'has_photo')
    const id = req.body.id;
    // Checkbox передає 'on' якщо відмічений, або true/false в json
    const includePhoto = req.body.includePhoto === 'on' || req.body.has_photo === 'on' || req.body.includePhoto === true;

    const item = inventory.find(i => i.id === id);

    if (item) {
        let resultDescription = item.description;
        if (includePhoto && item.photo) {
             // Додаємо посилання на фото до опису
             resultDescription += ` (Photo link: /inventory/${item.id}/photo)`;
        }
        
        // Повертаємо знайдений об'єкт (копіюємо, щоб не змінювати оригінал у базі)
        const resultItem = { ...item, description: resultDescription };
        res.status(200).json(resultItem);
    } else {
        [cite_start]res.status(404).send('Not Found'); // [cite: 78]
    }
});

// === СТАТИЧНІ ФАЙЛИ HTML ===
app.get('/RegisterForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

[cite_start]// === ОБРОБКА 405 Method Not Allowed [cite: 79] ===
// Це перехоплює будь-які методи, які не були оброблені вище для тих самих шляхів
app.all('*', (req, res) => {
    // Якщо шлях існує в наших визначених (наприклад /inventory), але метод не той -> 405
    // Для спрощення повертаємо 405 або 404
    if (req.path.startsWith('/inventory') || req.path.startsWith('/register')) {
         res.status(405).send('Method Not Allowed');
    } else {
         res.status(404).send('Page Not Found');
    }
});

[cite_start]// === ЗАПУСК СЕРВЕРА [cite: 43] ===
const server = http.createServer(app);

server.listen(options.port, options.host, () => {
    console.log(`Server is running at http://${options.host}:${options.port}`);
    console.log(`Cache directory: ${cacheDir}`);
    console.log(`Swagger docs at http://${options.host}:${options.port}/docs`);
});
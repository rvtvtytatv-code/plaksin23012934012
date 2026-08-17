const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '12345678';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultDb(){
  return {
    news: [],
    articles: [],
    consultations: [],
    quotes: [
      'Безопасность страны начинается с безопасности каждого отдельного объекта.',
      'Развитие российских технологий и расширение международного сотрудничества в области борьбы с терроризмом являются ключевыми направлениями государственной политики.',
      'Для повышения безопасности объектов и инфраструктуры необходимо создавать единую, интегрированную систему защиты.'
    ]
  };
}

function readDb(){
  try{
    if(!fs.existsSync(DB_FILE)){
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2), 'utf8');
    }

    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    db.news = Array.isArray(db.news) ? db.news : [];
    db.articles = Array.isArray(db.articles) ? db.articles : [];
    db.consultations = Array.isArray(db.consultations) ? db.consultations : [];
    db.quotes = Array.isArray(db.quotes) ? db.quotes : defaultDb().quotes;

    // перенос старых статей из news в articles, если они уже были сохранены через старую админку
    const moved = [];
    db.news = db.news.filter(item => {
      const isArticle =
        item.type === 'article' ||
        item.kind === 'article' ||
        item.section === 'articles';

      if(isArticle){
        moved.push({ ...item, type:'article', kind:'article', section:'articles' });
        return false;
      }

      return true;
    });

    for(const item of moved){
      if(!db.articles.some(x => String(x.id) === String(item.id) || String(x.slug) === String(item.slug))){
        db.articles.push(item);
      }
    }

    if(moved.length) saveDb(db);

    return db;
  }catch(e){
    console.error('DB read error:', e);
    return defaultDb();
  }
}

function saveDb(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function id(){
  return crypto.randomBytes(6).toString('hex');
}

function translit(text){
  const map = {
    а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y',
    к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u',
    ф:'f', х:'h', ц:'c', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya'
  };

  return String(text || '')
    .trim()
    .toLowerCase()
    .split('')
    .map(ch => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || id();
}

function uniqueSlug(items, base, currentId){
  let slug = base || id();
  let i = 2;

  while(items.some(item => item.slug === slug && item.id !== currentId)){
    slug = `${base}-${i++}`;
  }

  return slug;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});

const upload = multer({ storage });

const tokens = new Set();

app.use(cors({
  origin: true,
  credentials: false,
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.options('*', cors());
app.use(express.json({ limit:'20mb' }));
app.use(express.urlencoded({ extended:true }));

app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders(res){
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning');
  }
}));

app.use(express.static(PUBLIC_DIR));

function auth(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();

  if(tokens.has(token)) return next();

  return res.status(401).json({ error:'Нет авторизации' });
}

function normalizeFiles(req){
  const files = req.files || {};
  const coverFile = Array.isArray(files.cover) && files.cover[0] ? files.cover[0] : null;
  const galleryFiles = Array.isArray(files.gallery) ? files.gallery : [];

  return {
    cover: coverFile ? `/uploads/${coverFile.filename}` : null,
    gallery: galleryFiles.map(file => `/uploads/${file.filename}`)
  };
}

function makeItem(req, oldItem, collection){
  const files = normalizeFiles(req);
  const body = req.body || {};

  const baseTitle = body.title || oldItem?.title || 'Без названия';
  const baseSlug = translit(body.slug || baseTitle);
  const itemId = oldItem?.id || id();

  return {
    id: itemId,
    slug: uniqueSlug(collection, oldItem?.slug && body.title === oldItem.title ? oldItem.slug : baseSlug, itemId),
    title: baseTitle,
    topic: body.topic || '',
    date: body.date || new Date().toISOString().slice(0,10),
    excerpt: body.excerpt || '',
    body: body.body || '',
    cover: files.cover || oldItem?.cover || '',
    gallery: files.gallery.length ? files.gallery : (oldItem?.gallery || []),
    status: body.status || 'published',
    type: body.type || oldItem?.type || 'news',
    kind: body.kind || oldItem?.kind || body.type || oldItem?.type || 'news',
    section: body.section || oldItem?.section || (body.type === 'article' ? 'articles' : 'news'),
    createdAt: oldItem?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function findByKey(items, key){
  return items.find(item => String(item.id) === String(key) || String(item.slug) === String(key));
}

function sortItems(items){
  return [...items].sort((a,b) => {
    const ad = new Date(a.date || a.createdAt || 0).getTime();
    const bd = new Date(b.date || b.createdAt || 0).getTime();
    return bd - ad;
  });
}

function registerCrud(basePath, dbKey, typeName){
  app.get(`/api/${basePath}`, (req, res) => {
    const db = readDb();
    res.json(sortItems(db[dbKey] || []));
  });

  app.get(`/api/${basePath}/:key`, (req, res) => {
    const db = readDb();
    const item = findByKey(db[dbKey] || [], req.params.key);

    if(!item) return res.status(404).json({ error:'Запись не найдена' });

    res.json(item);
  });

  app.post(`/api/${basePath}`, auth, upload.fields([
    { name:'cover', maxCount:1 },
    { name:'gallery', maxCount:20 }
  ]), (req, res) => {
    const db = readDb();
    const collection = db[dbKey] || [];

    req.body.type = typeName;
    req.body.kind = typeName;
    req.body.section = typeName === 'article' ? 'articles' : 'news';

    const item = makeItem(req, null, collection);
    collection.unshift(item);
    db[dbKey] = collection;
    saveDb(db);

    res.status(201).json(item);
  });

  app.put(`/api/${basePath}/:key`, auth, upload.fields([
    { name:'cover', maxCount:1 },
    { name:'gallery', maxCount:20 }
  ]), (req, res) => {
    const db = readDb();
    const collection = db[dbKey] || [];
    const index = collection.findIndex(item => String(item.id) === String(req.params.key) || String(item.slug) === String(req.params.key));

    if(index === -1) return res.status(404).json({ error:'Запись не найдена' });

    req.body.type = typeName;
    req.body.kind = typeName;
    req.body.section = typeName === 'article' ? 'articles' : 'news';

    const updated = makeItem(req, collection[index], collection);
    collection[index] = updated;
    db[dbKey] = collection;
    saveDb(db);

    res.json(updated);
  });

  app.delete(`/api/${basePath}/:key`, auth, (req, res) => {
    const db = readDb();
    const collection = db[dbKey] || [];
    const item = findByKey(collection, req.params.key);

    if(!item) return res.status(404).json({ error:'Запись не найдена' });

    db[dbKey] = collection.filter(x => String(x.id) !== String(item.id) && String(x.slug) !== String(item.slug));
    saveDb(db);

    res.json({ ok:true, deleted:item });
  });
}

app.post('/api/login', (req, res) => {
  const { username, login, password } = req.body || {};
  const user = username || login;

  if(user === ADMIN_LOGIN && password === ADMIN_PASSWORD){
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    return res.json({ token });
  }

  return res.status(401).json({ error:'Неверный логин или пароль' });
});

app.get('/api/quotes', (req, res) => {
  const db = readDb();
  res.json(db.quotes);
});

registerCrud('news', 'news', 'news');
registerCrud('articles', 'articles', 'article');

app.post('/api/consultations', (req, res) => {
  const db = readDb();
  const item = {
    id:id(),
    name:req.body.name || '',
    contact:req.body.contact || '',
    format:req.body.format || '',
    company:req.body.company || '',
    message:req.body.message || '',
    createdAt:new Date().toISOString()
  };

  db.consultations.unshift(item);
  saveDb(db);

  res.status(201).json(item);
});

app.get('/api/consultations', auth, (req, res) => {
  const db = readDb();
  res.json(db.consultations || []);
});

app.get('/', (req, res) => {
  res.redirect('/admin.html');
});

app.listen(PORT, () => {
  console.log(`Backend started: http://localhost:${PORT}`);
});

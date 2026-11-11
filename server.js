'use strict';

const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const path = require('node:path');
const fs = require('node:fs');

// Load local .env without adding another dependency. Never serve this file.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const app = express();
const port = Number(process.env.PORT) || 3000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ratios = {
  '9:20': { size: '1024x1536', width: 1024, height: 1536 },
  '9:16': { size: '1024x1536', width: 1024, height: 1536 },
  '4:5': { size: '1024x1536', width: 1024, height: 1536 },
  '1:1': { size: '1024x1024', width: 1024, height: 1024 },
  '16:9': { size: '1536x1024', width: 1536, height: 1024 }
};
const styles = new Set([
  'Photorealistic portrait', 'Cinematic photography', 'Editorial portrait',
  'Artistic / graphic design', 'Studio portrait', 'Natural outdoor'
]);
const lightingOptions = new Set([
  'Soft cinematic light', 'Golden hour', 'Dramatic studio light',
  'Natural daylight', 'Moody low-key light'
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 2, fields: 4, fieldSize: 5000 },
  fileFilter: (_req, file, callback) => {
    if (!imageTypes.has(file.mimetype)) return callback(new Error('UNSUPPORTED_IMAGE_TYPE'));
    callback(null, true);
  }
});

app.use(express.static(__dirname, { dotfiles: 'deny', index: 'index.html' }));
app.get('/cinematic', (_req, res) => res.sendFile(path.join(__dirname, 'cinematic.html')));
app.get('/health', (_req, res) => res.json({ ok: true, generationConfigured: Boolean(process.env.OPENAI_API_KEY) }));

app.post('/api/generate', (req, res, next) => {
  upload.fields([{ name: 'fullBody', maxCount: 1 }, { name: 'faceCloseup', maxCount: 1 }])(req, res, err => {
    if (err) return next(err);
    generate(req, res).catch(next);
  });
});

async function generate(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI generation is not configured. Set OPENAI_API_KEY on the server.' });
  }
  const fullBody = req.files?.fullBody?.[0];
  const faceCloseup = req.files?.faceCloseup?.[0];
  if (!fullBody || !faceCloseup) {
    return res.status(400).json({ error: 'Provide both the full-body image and face close-up.' });
  }
  // Check actual file signatures too; multipart MIME values alone are untrusted.
  if (!hasValidImageSignature(fullBody) || !hasValidImageSignature(faceCloseup)) {
    return res.status(400).json({ error: 'An uploaded file is not a valid JPEG, PNG, or WebP image.' });
  }
  const ratio = String(req.body.ratio || '9:20');
  if (!Object.hasOwn(ratios, ratio)) return res.status(400).json({ error: 'Choose a supported aspect-ratio preset.' });
  const style = String(req.body.style || 'Cinematic photography');
  const lighting = String(req.body.lighting || 'Soft cinematic light');
  if (!styles.has(style) || !lightingOptions.has(lighting)) {
    return res.status(400).json({ error: 'Choose a supported visual style and lighting option.' });
  }
  const scene = String(req.body.prompt || '').trim();
  if (!scene) return res.status(400).json({ error: 'Describe the scene you want to generate.' });
  if (scene.length > 4000) return res.status(400).json({ error: 'Scene description must be 4,000 characters or fewer.' });

  const OpenAIToFile = OpenAI.toFile;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const instructions = [
    'Create one polished, realistic cinematic portrait image using the two supplied reference images of the SAME person.',
    'The first image is the full-body reference: prioritize body proportions, pose, clothing, accessories, and overall appearance from it.',
    'The second image is a close-up of that same person: prioritize facial identity, face shape, hairline, glasses and facial hair from it.',
    'Do not depict two people and do not blend the references as separate identities. Preserve natural skin texture.',
    'Do not add letters, words, captions, logos, watermarks, or typography; the user adds exact text separately.',
    `Visual style: ${style}. Lighting: ${lighting}. Scene: ${scene}`
  ].join('\n');
  const target = ratios[ratio];
  try {
    const result = await client.images.edit({
      model: 'gpt-image-1',
      image: [
        await OpenAIToFile(fullBody.buffer, fullBody.originalname, { type: fullBody.mimetype }),
        await OpenAIToFile(faceCloseup.buffer, faceCloseup.originalname, { type: faceCloseup.mimetype })
      ],
      prompt: instructions,
      size: target.size,
      quality: 'high',
      output_format: 'png'
    });
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) return res.status(502).json({ error: 'The image provider returned no image. Please try again.' });
    res.set('Cache-Control', 'no-store');
    return res.json({
      image: encoded,
      mimeType: 'image/png',
      requestedRatio: ratio,
      actualWidth: target.width,
      actualHeight: target.height,
      actualRatio: `${target.width}:${target.height}`,
      quality: 'high',
      model: 'gpt-image-1'
    });
  } catch (error) {
    // Keep provider response bodies, prompts, and credentials out of logs and UI.
    const status = Number(error?.status);
    if (status === 429) return res.status(429).json({ error: 'Image generation is rate-limited or the account has insufficient quota. Check provider usage and retry later.' });
    if (status === 401 || status === 403) return res.status(502).json({ error: 'The image provider rejected server credentials or account access. Check server configuration.' });
    if (status >= 400 && status < 500) return res.status(502).json({ error: 'The image provider could not process these inputs. Check image format, dimensions, and provider access.' });
    return res.status(502).json({ error: 'Image generation failed due to a provider or network problem. Please retry.' });
  }
}

function hasValidImageSignature(file) {
  const b = file.buffer;
  if (file.mimetype === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (file.mimetype === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/webp') return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 10 MB or smaller.' : 'Upload exactly two supported reference images.';
    return res.status(400).json({ error: message });
  }
  if (err?.message === 'UNSUPPORTED_IMAGE_TYPE') return res.status(400).json({ error: 'Only JPEG, PNG, or WebP images are supported.' });
  return res.status(500).json({ error: 'The server could not process this request.' });
});

app.listen(port, () => console.log(`Wallpaper Studio server listening on port ${port}`));

# Jibon AI Wallpaper Studio: cinematic generation

The existing `index.html` is a local typography editor. The optional `cinematic.html` page adds a real server-side image-generation route; it does not fabricate a result when the provider is unavailable.

## Run locally

Requirements: Node.js 20 or later, an OpenAI API account with image generation access, and a server-side API key. Image generation may incur charges; do not assume there is a free tier.

```sh
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` on the server (never in browser code), then start:

```sh
npm start
```

Open <http://localhost:3000/cinematic>. The existing typography editor remains at <http://localhost:3000/>.

## Generation behavior and limitations

- Uses the OpenAI Images API `gpt-image-1` image-edit endpoint with the two supplied references and high quality.
- The prompt tells the model the full-body image is the body/clothing reference and the close-up is the face-identity reference. This is guidance, not a guarantee of identity preservation.
- The API sizes used here are `1024x1536` portrait, `1024x1024` square, and `1536x1024` landscape. The 9:20, 9:16, and 4:5 requests map to portrait; the requested ratio is not natively fulfilled. 1440x3200 and custom sizes are not generated. The interface displays actual dimensions and warns that crop may occur.
- The generated image contains no requested typography; use the existing typography editor for locally composited text. Bengali rendering depends on browser font shaping.
- The OpenAI API key is read only by the server. Uploaded images are sent to the configured provider for generation. This app does not promise provider retention/deletion behavior; review provider terms before use.
- Request content and secrets are not logged. The sample server has no user authentication or production rate limiter. Add both before exposing it publicly.

## Deployment

Deploy the Node server (not a static-only GitHub Pages site), install dependencies, configure `OPENAI_API_KEY` as a server secret, and serve it over HTTPS. Never commit `.env` or paste a secret into client code.

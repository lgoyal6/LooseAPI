/**
 * Sender-domain -> service dictionary, scoped to things that bill you.
 *
 * This is the billing-focused subset of looseapi's `lib/services.ts`. The
 * dependency runs this way on purpose: devspend owns the parser and the
 * dictionary, and looseapi's dashboard imports from here, so there is one
 * place to add a provider rather than two that drift.
 *
 * Payment processors are intentionally absent — see PROCESSORS in costs.mjs.
 * Listing stripe.com here would let it capture every receipt it forwards.
 */
export const SERVICES = [
  // Hosting / platforms
  { id: "vercel", name: "Vercel", category: "hosting", domains: ["vercel.com"] },
  { id: "netlify", name: "Netlify", category: "hosting", domains: ["netlify.com"] },
  { id: "render", name: "Render", category: "hosting", domains: ["render.com"] },
  { id: "railway", name: "Railway", category: "hosting", domains: ["railway.app", "railway.com"] },
  { id: "fly", name: "Fly.io", category: "hosting", domains: ["fly.io"] },
  { id: "heroku", name: "Heroku", category: "hosting", domains: ["heroku.com"] },

  // Cloud
  { id: "aws", name: "Amazon Web Services", category: "cloud", domains: ["amazonaws.com", "aws.amazon.com"] },
  { id: "gcp", name: "Google Cloud", category: "cloud", domains: ["cloud.google.com"] },
  { id: "azure", name: "Microsoft Azure", category: "cloud", domains: ["azure.com", "azure.microsoft.com"] },
  { id: "cloudflare", name: "Cloudflare", category: "cloud", domains: ["cloudflare.com"] },
  { id: "digitalocean", name: "DigitalOcean", category: "cloud", domains: ["digitalocean.com"] },
  { id: "gmi", name: "GMI Cloud", category: "cloud", domains: ["gmicloud.ai"] },

  // AI / models
  { id: "anthropic", name: "Anthropic", category: "ai", domains: ["anthropic.com", "mail.anthropic.com"] },
  { id: "openai", name: "OpenAI", category: "ai", domains: ["openai.com"] },
  { id: "exa", name: "Exa Labs", category: "ai", domains: ["exa.ai"] },
  { id: "replicate", name: "Replicate", category: "ai", domains: ["replicate.com"] },
  { id: "huggingface", name: "Hugging Face", category: "ai", domains: ["huggingface.co"] },
  { id: "apify", name: "Apify", category: "ai", domains: ["apify.com"] },

  // Data / backend
  { id: "supabase", name: "Supabase", category: "data", domains: ["supabase.com", "supabase.io"] },
  { id: "convex", name: "Convex", category: "data", domains: ["convex.dev"] },
  { id: "neon", name: "Neon", category: "data", domains: ["neon.tech"] },
  { id: "planetscale", name: "PlanetScale", category: "data", domains: ["planetscale.com"] },
  { id: "upstash", name: "Upstash", category: "data", domains: ["upstash.com"] },
  { id: "mongodb", name: "MongoDB Atlas", category: "data", domains: ["mongodb.com"] },

  // Dev tooling
  { id: "github", name: "GitHub", category: "dev-tool", domains: ["github.com"] },
  { id: "docker", name: "Docker", category: "dev-tool", domains: ["docker.com"] },
  { id: "sentry", name: "Sentry", category: "dev-tool", domains: ["sentry.io"] },
  { id: "linear", name: "Linear", category: "dev-tool", domains: ["linear.app"] },
  { id: "notion", name: "Notion", category: "dev-tool", domains: ["notion.so", "makenotion.com"] },
  { id: "figma", name: "Figma", category: "dev-tool", domains: ["figma.com"] },
  { id: "overleaf", name: "Overleaf", category: "dev-tool", domains: ["overleaf.com"] },
  { id: "n8n", name: "n8n", category: "dev-tool", domains: ["n8n.io"] },

  // Subscriptions seen in a real inbox scan — added because each one was
  // sitting unread with a live or imminent charge attached.
  { id: "replit", name: "Replit", category: "dev-tool", domains: ["replit.com"] },
  { id: "atlassian", name: "Atlassian / Loom", category: "dev-tool", domains: ["atlassian.net", "atlassian.com"] },
  { id: "voiceos", name: "VoiceOS", category: "ai", domains: ["voiceos.com", "hello.voiceos.com"] },
  { id: "framer", name: "Framer", category: "dev-tool", domains: ["framer.com"] },
  { id: "mapbox", name: "Mapbox", category: "dev-tool", domains: ["mapbox.com"] },
  { id: "higgsfield", name: "Higgsfield", category: "ai", domains: ["higgsfield.ai", "team.higgsfield.ai"] },
  { id: "cursor", name: "Cursor", category: "dev-tool", domains: ["cursor.com", "cursor.sh"] },
  { id: "railway-app", name: "Railway", category: "hosting", domains: ["railway.app"] },

  // Consumer subscriptions. No APIs exist for any of these — Netflix, Prime,
  // Uber One and friends expose nothing — so receipt email is the only source.
  // That is an argument for the email spine, not a gap in it.
  { id: "netflix", name: "Netflix", category: "consumer", domains: ["netflix.com"] },
  { id: "amazon", name: "Amazon / Prime", category: "consumer", domains: ["amazon.com", "primevideo.com"] },
  { id: "uber", name: "Uber / Uber One", category: "consumer", domains: ["uber.com"] },
  { id: "spotify", name: "Spotify", category: "consumer", domains: ["spotify.com"] },
  { id: "apple", name: "Apple", category: "consumer", domains: ["apple.com", "email.apple.com"] },
  { id: "youtube", name: "YouTube Premium", category: "consumer", domains: ["youtube.com"] },
  { id: "disney", name: "Disney+", category: "consumer", domains: ["disneyplus.com"] },
  { id: "hulu", name: "Hulu", category: "consumer", domains: ["hulu.com"] },
  { id: "doordash", name: "DoorDash", category: "consumer", domains: ["doordash.com"] },
  { id: "instacart", name: "Instacart", category: "consumer", domains: ["instacart.com"] },
  { id: "openai-sub", name: "OpenAI / ChatGPT", category: "ai", domains: ["openai.com", "tm.openai.com"] },

  // Domains / infra
  { id: "namecheap", name: "Namecheap", category: "domains", domains: ["namecheap.com"] },
  { id: "godaddy", name: "GoDaddy", category: "domains", domains: ["godaddy.com"] },
  { id: "porkbun", name: "Porkbun", category: "domains", domains: ["porkbun.com"] },
];

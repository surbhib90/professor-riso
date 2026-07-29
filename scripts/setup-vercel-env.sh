#!/bin/bash
# Set environment variables in Vercel for production
# Run this after getting SUPABASE_SERVICE_ROLE_KEY from the Supabase dashboard

set -e

echo "Setting environment variables in Vercel..."

# Load from .env.local
source .env.local

# Check if SUPABASE_SERVICE_ROLE_KEY is set and not a placeholder
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ "$SUPABASE_SERVICE_ROLE_KEY" = "PASTE_YOUR_SERVICE_ROLE_KEY_HERE" ]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY not set in .env.local"
  echo "Get it from: https://supabase.com/dashboard → Project Settings → API → service_role key"
  exit 1
fi

# Set all required environment variables
vercel env add TAVUS_API_KEY production <<< "$TAVUS_API_KEY"
vercel env add TAVUS_PAL_ID production <<< "$TAVUS_PAL_ID"
vercel env add TAVUS_REPLICA_ID production <<< "$TAVUS_REPLICA_ID"
vercel env add TAVUS_DOCUMENT_IDS production <<< "$TAVUS_DOCUMENT_IDS"
vercel env add NEXT_PUBLIC_SUPABASE_URL production <<< "$NEXT_PUBLIC_SUPABASE_URL"
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production <<< "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
vercel env add TAVUS_WEBHOOK_SECRET production <<< "$TAVUS_WEBHOOK_SECRET"
vercel env add PUBLIC_APP_URL production <<< "$PUBLIC_APP_URL"
vercel env add SUPABASE_SERVICE_ROLE_KEY production <<< "$SUPABASE_SERVICE_ROLE_KEY"
vercel env add ANTHROPIC_API_KEY production <<< "$ANTHROPIC_API_KEY"

echo "✅ All environment variables set in Vercel production"
echo "Run 'vercel --prod' to redeploy with the new environment variables"

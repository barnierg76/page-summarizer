#!/bin/bash

# Script to set up Claritee project from page-summarizer

echo "Setting up Claritee project..."

# Navigate to parent directory
cd ..

# Clone the Claritee repository
echo "Cloning Claritee repository..."
git clone https://github.com/barnierg76/Claritee.git

# Copy all files from page-summarizer to Claritee
echo "Copying files to Claritee..."
cp -r page-summarizer/* Claritee/
cp page-summarizer/.gitignore Claritee/ 2>/dev/null
cp page-summarizer/.git/config Claritee/.git/config 2>/dev/null

# Navigate to Claritee
cd Claritee

# Update manifest.json with new name and add icon to action
echo "Updating manifest with Claritee branding..."
sed -i '' 's/"name": "Page Summarizer - Accessibility Helper"/"name": "Claritee - Web Content Clarity"/' manifest.json
sed -i '' 's/"description": "Get instant spoken summaries of any webpage for better accessibility. Understand content quickly with AI-powered summaries."/"description": "Advanced accessibility tool that brings clarity to web content through intelligent summarization and natural speech."/' manifest.json

# Add default_icon to action section for toolbar icon
sed -i '' '/"action": {/,/}/ s/"default_popup": "popup.html"/"default_popup": "popup.html",\
    "default_icon": {\
      "16": "icon16.png",\
      "48": "icon48.png",\
      "128": "icon128.png"\
    }/' manifest.json

# Stage and commit changes
echo "Committing changes..."
git add -A
git commit -m "Initial Claritee setup from page-summarizer

- Rebrand to Claritee
- Update manifest with new name and description
- All SSML improvements included

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push to GitHub
echo "Pushing to GitHub..."
git push -u origin main

echo "✅ Claritee setup complete!"
echo "Location: $(pwd)"
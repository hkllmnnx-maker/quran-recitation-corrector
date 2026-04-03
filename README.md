# مُصحِّح التلاوة - Quran Recitation Corrector

## Project Overview
- **Name**: Quran Recitation Corrector
- **Goal**: Web application for automated Quran recitation correction and evaluation
- **Features**: Speech recognition, text comparison, word-by-word analysis, Tajweed notes

## Features
- **114 Surah Selection**: Choose any surah from the complete Quran with specific ayah ranges
- **Voice Recording**: Real-time speech recognition using Web Speech API (Arabic)
- **Manual Input**: Type recitation manually as an alternative to voice
- **Smart Analysis**: 
  - Word-by-word comparison with normalized Arabic text
  - Character-level similarity scoring
  - Levenshtein distance algorithm for accurate matching
- **Detailed Results**:
  - Accuracy percentage with visual score ring
  - Color-coded word comparison (correct/wrong/missing/extra)
  - Per-ayah analysis with progress bars
  - Tajweed notes and improvement suggestions
- **Beautiful UI**: Islamic-themed dark green design with gold accents, RTL layout, responsive

## URLs
- **Preview**: https://3000-isdizfvz0k310v3nlujxr-b9b802c4.sandbox.novita.ai
- **Production**: (after Cloudflare deployment)

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/surahs` | List all 114 surahs |
| GET | `/api/surah/:number` | Get full surah with Uthmani text |
| GET | `/api/surah/:number/ayahs/:from/:to` | Get specific ayah range |
| POST | `/api/analyze` | Analyze recitation vs original text |

## Tech Stack
- **Backend**: Hono framework on Cloudflare Workers
- **Frontend**: Vanilla JS + Tailwind CSS + Font Awesome
- **Fonts**: Amiri (Quran text) + Cairo (UI) + Noto Naskh Arabic
- **Quran Data**: Al-Quran Cloud API (Uthmani script)
- **Speech**: Web Speech API (browser-native)

## How to Use
1. Select a surah from the dropdown
2. Set the ayah range (from/to)
3. Click "Display Ayahs" to see the Quran text
4. Either:
   - Click the microphone button and recite
   - Or type the recitation manually
5. Click "Analyze Recitation" to get results
6. Review the color-coded comparison and notes

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Active
- **Last Updated**: 2026-04-03

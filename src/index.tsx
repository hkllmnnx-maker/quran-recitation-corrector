import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('/api/*', cors())

// ============= API Routes =============

// Get list of all surahs
app.get('/api/surahs', async (c) => {
  try {
    const res = await fetch('https://api.alquran.cloud/v1/surah')
    const data = await res.json() as any
    if (data.code === 200) {
      const surahs = data.data.map((s: any) => ({
        number: s.number,
        name: s.name,
        englishName: s.englishName,
        englishNameTranslation: s.englishNameTranslation,
        numberOfAyahs: s.numberOfAyahs,
        revelationType: s.revelationType
      }))
      return c.json({ success: true, surahs })
    }
    return c.json({ success: false, error: 'Failed to fetch surahs' }, 500)
  } catch (err) {
    return c.json({ success: false, error: 'API error' }, 500)
  }
})

// Get a specific surah with Arabic text (Uthmani script)
app.get('/api/surah/:number', async (c) => {
  const num = c.req.param('number')
  try {
    const res = await fetch(`https://api.alquran.cloud/v1/surah/${num}/quran-uthmani`)
    const data = await res.json() as any
    if (data.code === 200) {
      const surah = {
        number: data.data.number,
        name: data.data.name,
        englishName: data.data.englishName,
        numberOfAyahs: data.data.numberOfAyahs,
        ayahs: data.data.ayahs.map((a: any) => ({
          number: a.numberInSurah,
          text: a.text,
          globalNumber: a.number
        }))
      }
      return c.json({ success: true, surah })
    }
    return c.json({ success: false, error: 'Surah not found' }, 500)
  } catch (err) {
    return c.json({ success: false, error: 'API error' }, 500)
  }
})

// Get specific ayahs range
app.get('/api/surah/:number/ayahs/:from/:to', async (c) => {
  const num = c.req.param('number')
  const from = parseInt(c.req.param('from'))
  const to = parseInt(c.req.param('to'))
  try {
    const res = await fetch(`https://api.alquran.cloud/v1/surah/${num}/quran-uthmani`)
    const data = await res.json() as any
    if (data.code === 200) {
      const ayahs = data.data.ayahs
        .filter((a: any) => a.numberInSurah >= from && a.numberInSurah <= to)
        .map((a: any) => ({
          number: a.numberInSurah,
          text: a.text,
          globalNumber: a.number
        }))
      return c.json({
        success: true,
        surahName: data.data.name,
        surahNumber: data.data.number,
        ayahs
      })
    }
    return c.json({ success: false, error: 'Not found' }, 500)
  } catch (err) {
    return c.json({ success: false, error: 'API error' }, 500)
  }
})

// Text comparison and analysis endpoint
app.post('/api/analyze', async (c) => {
  try {
    const body = await c.req.json() as any
    const { recitedText, originalAyahs } = body

    if (!recitedText || !originalAyahs || !Array.isArray(originalAyahs)) {
      return c.json({ success: false, error: 'Missing required fields' }, 400)
    }

    const analysis = analyzeRecitation(recitedText, originalAyahs)
    return c.json({ success: true, analysis })
  } catch (err) {
    return c.json({ success: false, error: 'Analysis error' }, 500)
  }
})

// ============= Text Analysis Functions =============

function normalizeArabic(text: string): string {
  return text
    // Remove tashkeel (diacritics)
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '')
    // Normalize alef variants
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    // Normalize taa marbuta to haa
    .replace(/\u0629/g, '\u0647')
    // Normalize alef maqsura to yaa
    .replace(/\u0649/g, '\u064A')
    // Remove tatweel
    .replace(/\u0640/g, '')
    // Remove extra spaces
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length
  const n = s2.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }
  return dp[m][n]
}

function getWordDiff(original: string[], recited: string[]): any[] {
  const m = original.length
  const n = recited.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (original[i - 1] === recited[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  // Backtrack to find operations
  const operations: any[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && original[i - 1] === recited[j - 1]) {
      operations.unshift({ type: 'correct', original: original[i - 1], recited: recited[j - 1] })
      i--; j--
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      operations.unshift({ type: 'substitution', original: original[i - 1], recited: recited[j - 1] })
      i--; j--
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      operations.unshift({ type: 'insertion', original: null, recited: recited[j - 1] })
      j--
    } else {
      operations.unshift({ type: 'deletion', original: original[i - 1], recited: null })
      i--
    }
  }
  return operations
}

interface AyahData {
  number: number
  text: string
}

function analyzeRecitation(recitedText: string, originalAyahs: AyahData[]) {
  const fullOriginal = originalAyahs.map(a => a.text).join(' ')
  const normalizedRecited = normalizeArabic(recitedText)
  const normalizedOriginal = normalizeArabic(fullOriginal)

  const originalWords = normalizedOriginal.split(' ').filter(w => w.length > 0)
  const recitedWords = normalizedRecited.split(' ').filter(w => w.length > 0)

  const wordDiff = getWordDiff(originalWords, recitedWords)

  // Calculate scores
  const totalWords = originalWords.length
  const correctWords = wordDiff.filter(d => d.type === 'correct').length
  const substitutions = wordDiff.filter(d => d.type === 'substitution')
  const insertions = wordDiff.filter(d => d.type === 'insertion')
  const deletions = wordDiff.filter(d => d.type === 'deletion')

  const accuracy = totalWords > 0 ? Math.round((correctWords / totalWords) * 100) : 0

  // Character-level similarity
  const charDistance = levenshteinDistance(normalizedRecited, normalizedOriginal)
  const maxLen = Math.max(normalizedRecited.length, normalizedOriginal.length)
  const charSimilarity = maxLen > 0 ? Math.round(((maxLen - charDistance) / maxLen) * 100) : 0

  // Per-ayah analysis
  const ayahAnalysis = analyzePerAyah(recitedText, originalAyahs)

  // Tajweed hints
  const tajweedNotes = generateTajweedNotes(substitutions, deletions, originalAyahs)

  // Overall grade
  let grade = ''
  let gradeClass = ''
  if (accuracy >= 95) { grade = 'ممتاز - ما شاء الله'; gradeClass = 'excellent' }
  else if (accuracy >= 85) { grade = 'جيد جداً'; gradeClass = 'very-good' }
  else if (accuracy >= 70) { grade = 'جيد - يحتاج مراجعة'; gradeClass = 'good' }
  else if (accuracy >= 50) { grade = 'مقبول - يحتاج تحسين'; gradeClass = 'acceptable' }
  else { grade = 'يحتاج إعادة المحاولة'; gradeClass = 'needs-work' }

  return {
    accuracy,
    charSimilarity,
    grade,
    gradeClass,
    totalWords,
    correctWords,
    errors: {
      substitutions: substitutions.length,
      insertions: insertions.length,
      deletions: deletions.length,
      total: substitutions.length + insertions.length + deletions.length
    },
    wordDiff,
    ayahAnalysis,
    tajweedNotes,
    originalText: fullOriginal,
    recitedText
  }
}

function analyzePerAyah(recitedText: string, originalAyahs: AyahData[]) {
  const normalizedRecited = normalizeArabic(recitedText)
  const results: any[] = []

  // Try to match recited text to each ayah
  let remainingText = normalizedRecited

  for (const ayah of originalAyahs) {
    const normalizedAyah = normalizeArabic(ayah.text)
    const ayahWords = normalizedAyah.split(' ').filter(w => w.length > 0)

    // Find best match in remaining text
    const recitedWords = remainingText.split(' ').filter(w => w.length > 0)
    const takeWords = Math.min(ayahWords.length + 3, recitedWords.length)
    const matchWords = recitedWords.slice(0, takeWords)

    const distance = levenshteinDistance(matchWords.join(' '), normalizedAyah)
    const maxLen = Math.max(matchWords.join(' ').length, normalizedAyah.length)
    const similarity = maxLen > 0 ? Math.round(((maxLen - distance) / maxLen) * 100) : 0

    results.push({
      ayahNumber: ayah.number,
      originalText: ayah.text,
      similarity,
      status: similarity >= 90 ? 'correct' : similarity >= 60 ? 'partial' : 'error'
    })

    // Remove matched words from remaining
    remainingText = recitedWords.slice(ayahWords.length).join(' ')
  }

  return results
}

function generateTajweedNotes(substitutions: any[], deletions: any[], ayahs: AyahData[]): string[] {
  const notes: string[] = []

  if (substitutions.length > 0) {
    notes.push(`تم العثور على ${substitutions.length} كلمة مختلفة عن النص الأصلي - راجع الكلمات المحددة باللون الأحمر`)

    // Check for common patterns
    const subPairs = substitutions.map(s => ({ orig: s.original, rec: s.recited }))
    for (const pair of subPairs.slice(0, 5)) {
      if (pair.orig && pair.rec) {
        const dist = levenshteinDistance(pair.orig, pair.rec)
        if (dist === 1) {
          notes.push(`كلمة "${pair.rec}" قريبة من "${pair.orig}" - تأكد من مخرج الحرف الصحيح`)
        } else if (dist <= 2) {
          notes.push(`كلمة "${pair.rec}" بدلاً من "${pair.orig}" - راجع نطق الكلمة`)
        }
      }
    }
  }

  if (deletions.length > 0) {
    notes.push(`تم حذف ${deletions.length} كلمة من النص الأصلي - تأكد من قراءة جميع الكلمات`)
    const missingWords = deletions.slice(0, 5).map(d => d.original).filter(Boolean)
    if (missingWords.length > 0) {
      notes.push(`الكلمات المحذوفة تشمل: ${missingWords.join('، ')}`)
    }
  }

  if (substitutions.length === 0 && deletions.length === 0) {
    notes.push('ما شاء الله! القراءة مطابقة للنص القرآني')
    notes.push('استمر في التدرب على أحكام التجويد: الإدغام، الإخفاء، الإقلاب، والإظهار')
  }

  return notes
}

// ============= Main Page =============
app.get('/', (c) => {
  return c.html(getMainHTML())
})

function getMainHTML(): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>مُصحِّح التلاوة - تصحيح تلاوة القرآن الكريم</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Cairo:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              gold: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207', 800: '#854d0e', 900: '#713f12' },
              quran: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d', 950: '#052e16' }
            },
            fontFamily: {
              amiri: ['Amiri', 'serif'],
              naskh: ['Noto Naskh Arabic', 'serif'],
              cairo: ['Cairo', 'sans-serif']
            }
          }
        }
      }
    </script>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Cairo', sans-serif; background: linear-gradient(135deg, #052e16 0%, #14532d 30%, #166534 60%, #052e16 100%); min-height: 100vh; }
      .quran-text { font-family: 'Amiri', serif; font-size: 1.6rem; line-height: 2.5; }
      .ayah-number { font-family: 'Noto Naskh Arabic', serif; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: linear-gradient(135deg, #ca8a04, #eab308); color: #052e16; border-radius: 50%; font-size: 0.75rem; font-weight: 700; margin: 0 4px; vertical-align: middle; }
      .glass { background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); }
      .glass-light { background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(20px); }
      .word-correct { color: #22c55e; background: rgba(34, 197, 94, 0.1); padding: 2px 4px; border-radius: 4px; }
      .word-error { color: #ef4444; background: rgba(239, 68, 68, 0.15); padding: 2px 6px; border-radius: 4px; text-decoration: line-through; text-decoration-color: rgba(239,68,68,0.5); }
      .word-missing { color: #f97316; background: rgba(249, 115, 22, 0.15); padding: 2px 6px; border-radius: 4px; border-bottom: 2px dashed #f97316; }
      .word-extra { color: #a855f7; background: rgba(168, 85, 247, 0.15); padding: 2px 6px; border-radius: 4px; font-style: italic; }
      .recording-pulse { animation: pulse-ring 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }
      @keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); } 70% { box-shadow: 0 0 0 20px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
      .wave-animation { display: flex; align-items: center; gap: 3px; height: 40px; }
      .wave-bar { width: 4px; background: #ef4444; border-radius: 2px; animation: wave 1s ease-in-out infinite; }
      .wave-bar:nth-child(1) { animation-delay: 0s; }
      .wave-bar:nth-child(2) { animation-delay: 0.1s; }
      .wave-bar:nth-child(3) { animation-delay: 0.2s; }
      .wave-bar:nth-child(4) { animation-delay: 0.3s; }
      .wave-bar:nth-child(5) { animation-delay: 0.4s; }
      @keyframes wave { 0%, 100% { height: 10px; } 50% { height: 35px; } }
      .ornament { background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ca8a04' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
      .score-ring { transition: stroke-dashoffset 1s ease-in-out; }
      select option { direction: rtl; }
      .fade-in { animation: fadeIn 0.5s ease-in; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .surah-select { scrollbar-width: thin; scrollbar-color: #ca8a04 #052e16; }
      .surah-select::-webkit-scrollbar { width: 8px; }
      .surah-select::-webkit-scrollbar-track { background: #052e16; border-radius: 4px; }
      .surah-select::-webkit-scrollbar-thumb { background: #ca8a04; border-radius: 4px; }
      .bismillah { font-family: 'Amiri', serif; font-size: 1.8rem; color: #ca8a04; text-align: center; margin-bottom: 1rem; }
    </style>
</head>
<body class="ornament">
    <!-- Header -->
    <header class="glass border-b border-gold-700/30">
        <div class="max-w-6xl mx-auto px-4 py-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center shadow-lg">
                        <i class="fas fa-book-quran text-xl text-quran-950"></i>
                    </div>
                    <div>
                        <h1 class="text-xl font-bold text-gold-400 font-cairo">مُصحِّح التلاوة</h1>
                        <p class="text-xs text-green-300/70">تصحيح تلاوة القرآن الكريم آلياً</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-3 py-1 rounded-full glass text-gold-400 text-xs font-cairo">
                        <i class="fas fa-microphone-lines ml-1"></i>
                        التعرف الصوتي
                    </span>
                </div>
            </div>
        </div>
    </header>

    <main class="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <!-- Step 1: Select Surah & Ayahs -->
        <section class="glass rounded-2xl p-6 fade-in">
            <div class="flex items-center gap-2 mb-4">
                <span class="w-8 h-8 rounded-lg bg-gold-600 flex items-center justify-center text-white text-sm font-bold">1</span>
                <h2 class="text-lg font-bold text-gold-400 font-cairo">اختر السورة والآيات</h2>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-green-300/80 text-sm mb-2 font-cairo">السورة</label>
                    <select id="surahSelect" class="w-full bg-quran-950/50 text-white border border-gold-700/30 rounded-xl px-4 py-3 font-cairo focus:outline-none focus:border-gold-500 surah-select" onchange="onSurahChange()">
                        <option value="">-- اختر السورة --</option>
                    </select>
                </div>
                <div>
                    <label class="block text-green-300/80 text-sm mb-2 font-cairo">من الآية</label>
                    <input type="number" id="ayahFrom" min="1" value="1" class="w-full bg-quran-950/50 text-white border border-gold-700/30 rounded-xl px-4 py-3 font-cairo focus:outline-none focus:border-gold-500" onchange="loadAyahs()">
                </div>
                <div>
                    <label class="block text-green-300/80 text-sm mb-2 font-cairo">إلى الآية</label>
                    <input type="number" id="ayahTo" min="1" value="7" class="w-full bg-quran-950/50 text-white border border-gold-700/30 rounded-xl px-4 py-3 font-cairo focus:outline-none focus:border-gold-500" onchange="loadAyahs()">
                </div>
            </div>

            <button id="loadBtn" onclick="loadAyahs()" class="mt-4 bg-gradient-to-l from-gold-600 to-gold-700 hover:from-gold-500 hover:to-gold-600 text-quran-950 font-bold py-3 px-8 rounded-xl font-cairo transition-all flex items-center gap-2 mx-auto">
                <i class="fas fa-book-open"></i>
                عرض الآيات
            </button>
        </section>

        <!-- Quran Display -->
        <section id="quranDisplay" class="hidden glass rounded-2xl p-6 fade-in">
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2">
                    <span class="w-8 h-8 rounded-lg bg-gold-600 flex items-center justify-center text-white text-sm font-bold">2</span>
                    <h2 class="text-lg font-bold text-gold-400 font-cairo">النص القرآني</h2>
                </div>
                <span id="surahTitle" class="text-gold-500 font-amiri text-lg"></span>
            </div>
            
            <div class="bg-quran-950/40 rounded-xl p-6 border border-gold-700/20">
                <div class="bismillah" id="bismillah"></div>
                <div id="ayahsContainer" class="quran-text text-white text-center leading-[3]"></div>
            </div>
            <p class="text-green-300/60 text-xs mt-2 text-center font-cairo">
                <i class="fas fa-info-circle ml-1"></i>
                اقرأ الآيات أعلاه ثم سجّل تلاوتك بالضغط على زر التسجيل
            </p>
        </section>

        <!-- Step 2: Record -->
        <section id="recordSection" class="hidden glass rounded-2xl p-6 fade-in">
            <div class="flex items-center gap-2 mb-4">
                <span class="w-8 h-8 rounded-lg bg-gold-600 flex items-center justify-center text-white text-sm font-bold">3</span>
                <h2 class="text-lg font-bold text-gold-400 font-cairo">سجّل تلاوتك</h2>
            </div>

            <div class="text-center space-y-4">
                <!-- Recording button -->
                <button id="recordBtn" onclick="toggleRecording()" class="w-24 h-24 rounded-full bg-gradient-to-br from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 text-white text-3xl shadow-2xl transition-all mx-auto flex items-center justify-center">
                    <i class="fas fa-microphone"></i>
                </button>
                <p id="recordStatus" class="text-green-300/70 text-sm font-cairo">اضغط للبدء بالتسجيل</p>
                
                <!-- Wave animation (hidden by default) -->
                <div id="waveContainer" class="hidden justify-center">
                    <div class="wave-animation">
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                    </div>
                </div>

                <!-- Recognized text preview -->
                <div id="recognizedPreview" class="hidden bg-quran-950/40 rounded-xl p-4 border border-gold-700/20 text-right">
                    <p class="text-xs text-gold-500/70 mb-2 font-cairo"><i class="fas fa-language ml-1"></i> النص المُتعرَّف عليه:</p>
                    <p id="recognizedText" class="quran-text text-white text-lg"></p>
                </div>

                <!-- Manual input option -->
                <div class="border-t border-gold-700/20 pt-4 mt-4">
                    <button onclick="toggleManualInput()" class="text-gold-400 text-sm font-cairo hover:text-gold-300 transition-colors">
                        <i class="fas fa-keyboard ml-1"></i>
                        أو اكتب التلاوة يدوياً
                    </button>
                    <div id="manualInput" class="hidden mt-3">
                        <textarea id="manualText" rows="4" class="w-full bg-quran-950/50 text-white border border-gold-700/30 rounded-xl px-4 py-3 font-amiri text-lg focus:outline-none focus:border-gold-500 resize-none text-right" placeholder="اكتب التلاوة هنا..."></textarea>
                    </div>
                </div>

                <!-- Analyze button -->
                <button id="analyzeBtn" onclick="analyzeRecitation()" class="hidden bg-gradient-to-l from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-bold py-3 px-10 rounded-xl font-cairo transition-all shadow-lg">
                    <i class="fas fa-magnifying-glass-chart ml-2"></i>
                    تحليل التلاوة
                </button>
            </div>
        </section>

        <!-- Loading -->
        <div id="loadingSection" class="hidden text-center py-12">
            <div class="inline-block">
                <i class="fas fa-spinner fa-spin text-gold-400 text-4xl"></i>
                <p class="text-green-300/70 mt-3 font-cairo">جاري تحليل التلاوة...</p>
            </div>
        </div>

        <!-- Results -->
        <section id="resultsSection" class="hidden space-y-6 fade-in">
            <!-- Score Card -->
            <div class="glass rounded-2xl p-6">
                <div class="flex items-center gap-2 mb-6">
                    <span class="w-8 h-8 rounded-lg bg-gold-600 flex items-center justify-center text-white text-sm font-bold">4</span>
                    <h2 class="text-lg font-bold text-gold-400 font-cairo">نتيجة التقييم</h2>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <!-- Score Ring -->
                    <div class="flex flex-col items-center">
                        <div class="relative w-40 h-40">
                            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.1)" stroke-width="8" fill="none"/>
                                <circle id="scoreRing" cx="50" cy="50" r="45" stroke="#22c55e" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="283" class="score-ring"/>
                            </svg>
                            <div class="absolute inset-0 flex flex-col items-center justify-center">
                                <span id="scorePercent" class="text-3xl font-bold text-white">0%</span>
                                <span class="text-xs text-green-300/60 font-cairo">الدقة</span>
                            </div>
                        </div>
                        <p id="gradeText" class="mt-3 text-lg font-bold font-cairo text-gold-400"></p>
                    </div>

                    <!-- Stats -->
                    <div class="space-y-3">
                        <h3 class="text-gold-500 font-cairo font-semibold mb-3"><i class="fas fa-chart-bar ml-1"></i> إحصائيات التلاوة</h3>
                        <div class="flex justify-between items-center bg-quran-950/30 rounded-lg px-4 py-2">
                            <span class="text-green-300/70 text-sm font-cairo">إجمالي الكلمات</span>
                            <span id="statTotal" class="text-white font-bold">0</span>
                        </div>
                        <div class="flex justify-between items-center bg-quran-950/30 rounded-lg px-4 py-2">
                            <span class="text-green-300/70 text-sm font-cairo">الكلمات الصحيحة</span>
                            <span id="statCorrect" class="text-green-400 font-bold">0</span>
                        </div>
                        <div class="flex justify-between items-center bg-quran-950/30 rounded-lg px-4 py-2">
                            <span class="text-green-300/70 text-sm font-cairo">الأخطاء</span>
                            <span id="statErrors" class="text-red-400 font-bold">0</span>
                        </div>
                        <div class="flex justify-between items-center bg-quran-950/30 rounded-lg px-4 py-2">
                            <span class="text-green-300/70 text-sm font-cairo">التشابه الحرفي</span>
                            <span id="statCharSim" class="text-gold-400 font-bold">0%</span>
                        </div>
                    </div>

                    <!-- Error Breakdown -->
                    <div class="space-y-3">
                        <h3 class="text-gold-500 font-cairo font-semibold mb-3"><i class="fas fa-triangle-exclamation ml-1"></i> تفصيل الأخطاء</h3>
                        <div class="flex justify-between items-center bg-quran-950/30 rounded-lg px-4 py-2">
                            <span class="text-green-300/70 text-sm font-cairo flex items-center gap-1">
                                <span class="w-3 h-3 rounded bg-red-500 inline-block"></span>
                                كلمات خاطئة
                            </span>
                            <span id="statSub" class="text-red-400 font-bold">0</span>
                        </div>
                        <div class="flex justify-between items-center bg-quran-950/30 rounded-lg px-4 py-2">
                            <span class="text-green-300/70 text-sm font-cairo flex items-center gap-1">
                                <span class="w-3 h-3 rounded bg-orange-500 inline-block"></span>
                                كلمات محذوفة
                            </span>
                            <span id="statDel" class="text-orange-400 font-bold">0</span>
                        </div>
                        <div class="flex justify-between items-center bg-quran-950/30 rounded-lg px-4 py-2">
                            <span class="text-green-300/70 text-sm font-cairo flex items-center gap-1">
                                <span class="w-3 h-3 rounded bg-purple-500 inline-block"></span>
                                كلمات زائدة
                            </span>
                            <span id="statIns" class="text-purple-400 font-bold">0</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Detailed Comparison -->
            <div class="glass rounded-2xl p-6">
                <h3 class="text-gold-400 font-cairo font-bold mb-4 flex items-center gap-2">
                    <i class="fas fa-code-compare"></i>
                    المقارنة التفصيلية
                </h3>
                <div class="bg-quran-950/40 rounded-xl p-6 border border-gold-700/20">
                    <div id="comparisonView" class="quran-text text-lg leading-[3] text-right"></div>
                </div>
                <div class="flex flex-wrap gap-4 mt-4 justify-center">
                    <span class="flex items-center gap-1 text-xs font-cairo">
                        <span class="w-3 h-3 rounded bg-green-500 inline-block"></span>
                        <span class="text-green-300/70">صحيح</span>
                    </span>
                    <span class="flex items-center gap-1 text-xs font-cairo">
                        <span class="w-3 h-3 rounded bg-red-500 inline-block"></span>
                        <span class="text-green-300/70">خطأ (استبدال)</span>
                    </span>
                    <span class="flex items-center gap-1 text-xs font-cairo">
                        <span class="w-3 h-3 rounded bg-orange-500 inline-block"></span>
                        <span class="text-green-300/70">محذوف</span>
                    </span>
                    <span class="flex items-center gap-1 text-xs font-cairo">
                        <span class="w-3 h-3 rounded bg-purple-500 inline-block"></span>
                        <span class="text-green-300/70">زائد</span>
                    </span>
                </div>
            </div>

            <!-- Per-Ayah Analysis -->
            <div class="glass rounded-2xl p-6">
                <h3 class="text-gold-400 font-cairo font-bold mb-4 flex items-center gap-2">
                    <i class="fas fa-list-check"></i>
                    تحليل كل آية
                </h3>
                <div id="ayahAnalysis" class="space-y-3"></div>
            </div>

            <!-- Tajweed Notes -->
            <div class="glass rounded-2xl p-6">
                <h3 class="text-gold-400 font-cairo font-bold mb-4 flex items-center gap-2">
                    <i class="fas fa-lightbulb"></i>
                    ملاحظات وتوجيهات
                </h3>
                <div id="tajweedNotes" class="space-y-2"></div>
            </div>

            <!-- Retry Button -->
            <div class="text-center">
                <button onclick="resetAll()" class="bg-gradient-to-l from-gold-600 to-gold-700 hover:from-gold-500 hover:to-gold-600 text-quran-950 font-bold py-3 px-10 rounded-xl font-cairo transition-all shadow-lg">
                    <i class="fas fa-redo ml-2"></i>
                    إعادة المحاولة
                </button>
            </div>
        </section>
    </main>

    <!-- Footer -->
    <footer class="glass border-t border-gold-700/30 mt-12 py-6">
        <div class="max-w-6xl mx-auto px-4 text-center">
            <p class="text-green-300/50 text-sm font-cairo">
                مُصحِّح التلاوة - أداة لتصحيح تلاوة القرآن الكريم آلياً
            </p>
            <p class="text-green-300/30 text-xs mt-1 font-cairo">
                يستخدم التعرف على الكلام في المتصفح ومقارنة نصية متقدمة
            </p>
        </div>
    </footer>

    <script>
    // ============= State =============
    let surahs = [];
    let currentAyahs = [];
    let currentSurahNumber = 0;
    let isRecording = false;
    let recognition = null;
    let finalTranscript = '';
    let interimTranscript = '';

    // ============= Initialize =============
    document.addEventListener('DOMContentLoaded', () => {
        loadSurahs();
        initSpeechRecognition();
    });

    async function loadSurahs() {
        try {
            const res = await fetch('/api/surahs');
            const data = await res.json();
            if (data.success) {
                surahs = data.surahs;
                const select = document.getElementById('surahSelect');
                surahs.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.number;
                    opt.textContent = s.number + ' - ' + s.name + ' (' + s.englishName + ') - ' + s.numberOfAyahs + ' آيات';
                    select.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Error loading surahs:', err);
        }
    }

    function onSurahChange() {
        const num = parseInt(document.getElementById('surahSelect').value);
        if (!num) return;
        const surah = surahs.find(s => s.number === num);
        if (surah) {
            document.getElementById('ayahFrom').value = 1;
            document.getElementById('ayahTo').value = Math.min(surah.numberOfAyahs, 10);
            document.getElementById('ayahTo').max = surah.numberOfAyahs;
            document.getElementById('ayahFrom').max = surah.numberOfAyahs;
        }
    }

    async function loadAyahs() {
        const surahNum = document.getElementById('surahSelect').value;
        const from = parseInt(document.getElementById('ayahFrom').value);
        const to = parseInt(document.getElementById('ayahTo').value);

        if (!surahNum || !from || !to) return;
        if (from > to) {
            alert('رقم آية البداية يجب أن يكون أقل من أو يساوي رقم آية النهاية');
            return;
        }

        currentSurahNumber = parseInt(surahNum);

        try {
            document.getElementById('loadBtn').innerHTML = '<i class="fas fa-spinner fa-spin ml-2"></i> جاري التحميل...';
            
            const res = await fetch('/api/surah/' + surahNum + '/ayahs/' + from + '/' + to);
            const data = await res.json();

            if (data.success) {
                currentAyahs = data.ayahs;
                displayAyahs(data);
                document.getElementById('quranDisplay').classList.remove('hidden');
                document.getElementById('recordSection').classList.remove('hidden');
                document.getElementById('resultsSection').classList.add('hidden');

                // Scroll to quran display
                document.getElementById('quranDisplay').scrollIntoView({ behavior: 'smooth' });
            }
        } catch (err) {
            console.error('Error:', err);
            alert('حدث خطأ في تحميل الآيات');
        } finally {
            document.getElementById('loadBtn').innerHTML = '<i class="fas fa-book-open ml-2"></i> عرض الآيات';
        }
    }

    function displayAyahs(data) {
        const container = document.getElementById('ayahsContainer');
        const surahTitle = document.getElementById('surahTitle');
        const bismillah = document.getElementById('bismillah');

        surahTitle.textContent = data.surahName || '';

        // Show Bismillah for surahs other than Al-Fatiha and At-Tawbah
        if (currentSurahNumber !== 1 && currentSurahNumber !== 9 && parseInt(document.getElementById('ayahFrom').value) === 1) {
            bismillah.textContent = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';
        } else {
            bismillah.textContent = '';
        }

        let html = '';
        data.ayahs.forEach(a => {
            html += '<span class="ayah-text">' + a.text + '</span> ';
            html += '<span class="ayah-number">' + a.number + '</span> ';
        });
        container.innerHTML = html;
    }

    // ============= Speech Recognition =============
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            document.getElementById('recordBtn').style.display = 'none';
            document.getElementById('recordStatus').textContent = 'المتصفح لا يدعم التعرف الصوتي - استخدم الإدخال اليدوي';
            document.getElementById('manualInput').classList.remove('hidden');
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'ar-SA';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript + ' ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            const preview = document.getElementById('recognizedText');
            preview.textContent = finalTranscript + interimTranscript;
            document.getElementById('recognizedPreview').classList.remove('hidden');
            document.getElementById('analyzeBtn').classList.remove('hidden');
        };

        recognition.onerror = (event) => {
            console.error('Speech error:', event.error);
            if (event.error === 'no-speech') {
                document.getElementById('recordStatus').textContent = 'لم يتم التعرف على أي كلام - حاول مرة أخرى';
            } else if (event.error === 'not-allowed') {
                document.getElementById('recordStatus').textContent = 'يرجى السماح بالوصول إلى الميكروفون';
            }
        };

        recognition.onend = () => {
            if (isRecording) {
                // Restart if still recording
                try { recognition.start(); } catch(e) {}
            } else {
                stopRecordingUI();
            }
        };
    }

    function toggleRecording() {
        if (!recognition) {
            // Fallback to manual input
            toggleManualInput();
            return;
        }

        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    function startRecording() {
        finalTranscript = '';
        interimTranscript = '';
        isRecording = true;

        try {
            recognition.start();
        } catch(e) {
            recognition.stop();
            setTimeout(() => {
                recognition.start();
            }, 100);
        }

        const btn = document.getElementById('recordBtn');
        btn.classList.add('recording-pulse');
        btn.innerHTML = '<i class="fas fa-stop"></i>';
        btn.classList.remove('from-red-500', 'to-red-700');
        btn.classList.add('from-red-600', 'to-red-800');
        document.getElementById('recordStatus').textContent = 'جاري التسجيل... اضغط للإيقاف';
        document.getElementById('waveContainer').classList.remove('hidden');
        document.getElementById('waveContainer').classList.add('flex');
    }

    function stopRecording() {
        isRecording = false;
        if (recognition) {
            recognition.stop();
        }
        stopRecordingUI();
    }

    function stopRecordingUI() {
        const btn = document.getElementById('recordBtn');
        btn.classList.remove('recording-pulse');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        btn.classList.remove('from-red-600', 'to-red-800');
        btn.classList.add('from-red-500', 'to-red-700');
        document.getElementById('recordStatus').textContent = 'تم إيقاف التسجيل';
        document.getElementById('waveContainer').classList.add('hidden');
        document.getElementById('waveContainer').classList.remove('flex');

        if (finalTranscript.trim()) {
            document.getElementById('analyzeBtn').classList.remove('hidden');
        }
    }

    function toggleManualInput() {
        const manual = document.getElementById('manualInput');
        manual.classList.toggle('hidden');
        if (!manual.classList.contains('hidden')) {
            document.getElementById('analyzeBtn').classList.remove('hidden');
            document.getElementById('manualText').focus();
        }
    }

    // ============= Analysis =============
    async function analyzeRecitation() {
        let recitedText = finalTranscript.trim();
        
        // Check manual input
        const manualText = document.getElementById('manualText').value.trim();
        if (manualText) {
            recitedText = manualText;
        }

        if (!recitedText) {
            alert('لم يتم التعرف على أي نص. يرجى التسجيل مرة أخرى أو الكتابة يدوياً.');
            return;
        }

        if (currentAyahs.length === 0) {
            alert('يرجى اختيار السورة والآيات أولاً');
            return;
        }

        // Show loading
        document.getElementById('loadingSection').classList.remove('hidden');
        document.getElementById('resultsSection').classList.add('hidden');

        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recitedText: recitedText,
                    originalAyahs: currentAyahs
                })
            });
            const data = await res.json();

            if (data.success) {
                displayResults(data.analysis);
            } else {
                alert('حدث خطأ في التحليل');
            }
        } catch (err) {
            console.error('Analysis error:', err);
            alert('حدث خطأ في الاتصال');
        } finally {
            document.getElementById('loadingSection').classList.add('hidden');
        }
    }

    function displayResults(analysis) {
        const resultsSection = document.getElementById('resultsSection');
        resultsSection.classList.remove('hidden');

        // Animate score ring
        const ring = document.getElementById('scoreRing');
        const circumference = 2 * Math.PI * 45; // ~283
        const offset = circumference - (analysis.accuracy / 100) * circumference;
        ring.style.strokeDashoffset = offset;

        // Set ring color based on score
        if (analysis.accuracy >= 90) ring.style.stroke = '#22c55e';
        else if (analysis.accuracy >= 70) ring.style.stroke = '#eab308';
        else if (analysis.accuracy >= 50) ring.style.stroke = '#f97316';
        else ring.style.stroke = '#ef4444';

        document.getElementById('scorePercent').textContent = analysis.accuracy + '%';
        document.getElementById('gradeText').textContent = analysis.grade;

        // Stats
        document.getElementById('statTotal').textContent = analysis.totalWords;
        document.getElementById('statCorrect').textContent = analysis.correctWords;
        document.getElementById('statErrors').textContent = analysis.errors.total;
        document.getElementById('statCharSim').textContent = analysis.charSimilarity + '%';
        document.getElementById('statSub').textContent = analysis.errors.substitutions;
        document.getElementById('statDel').textContent = analysis.errors.deletions;
        document.getElementById('statIns').textContent = analysis.errors.insertions;

        // Comparison view
        displayComparison(analysis.wordDiff);

        // Per-ayah analysis
        displayAyahAnalysis(analysis.ayahAnalysis);

        // Tajweed notes
        displayTajweedNotes(analysis.tajweedNotes);

        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    function displayComparison(wordDiff) {
        const container = document.getElementById('comparisonView');
        let html = '';

        wordDiff.forEach(item => {
            switch (item.type) {
                case 'correct':
                    html += '<span class="word-correct">' + escapeHtml(item.original) + '</span> ';
                    break;
                case 'substitution':
                    html += '<span class="word-error" title="القراءة: ' + escapeHtml(item.recited || '') + '">' + escapeHtml(item.original) + '</span> ';
                    break;
                case 'deletion':
                    html += '<span class="word-missing" title="كلمة محذوفة">' + escapeHtml(item.original) + '</span> ';
                    break;
                case 'insertion':
                    html += '<span class="word-extra" title="كلمة زائدة">' + escapeHtml(item.recited || '') + '</span> ';
                    break;
            }
        });

        container.innerHTML = html;
    }

    function displayAyahAnalysis(ayahAnalysis) {
        const container = document.getElementById('ayahAnalysis');
        let html = '';

        ayahAnalysis.forEach(a => {
            let statusIcon = '';
            let statusColor = '';
            let statusText = '';

            if (a.status === 'correct') {
                statusIcon = 'fa-check-circle';
                statusColor = 'text-green-400';
                statusText = 'صحيح';
            } else if (a.status === 'partial') {
                statusIcon = 'fa-exclamation-circle';
                statusColor = 'text-yellow-400';
                statusText = 'جزئي';
            } else {
                statusIcon = 'fa-times-circle';
                statusColor = 'text-red-400';
                statusText = 'يحتاج مراجعة';
            }

            html += '<div class="bg-quran-950/30 rounded-xl p-4 border border-gold-700/10">';
            html += '<div class="flex items-center justify-between mb-2">';
            html += '<div class="flex items-center gap-2">';
            html += '<span class="ayah-number" style="width:28px;height:28px;font-size:0.7rem">' + a.ayahNumber + '</span>';
            html += '<span class="' + statusColor + ' text-sm font-cairo"><i class="fas ' + statusIcon + ' ml-1"></i>' + statusText + '</span>';
            html += '</div>';
            html += '<span class="text-sm font-bold ' + statusColor + '">' + a.similarity + '%</span>';
            html += '</div>';
            html += '<p class="quran-text text-white text-sm">' + escapeHtml(a.originalText) + '</p>';
            html += '<div class="mt-2 bg-gray-700/30 rounded-full h-2"><div class="h-2 rounded-full transition-all" style="width:' + a.similarity + '%;background:' + (a.similarity >= 90 ? '#22c55e' : a.similarity >= 60 ? '#eab308' : '#ef4444') + '"></div></div>';
            html += '</div>';
        });

        container.innerHTML = html;
    }

    function displayTajweedNotes(notes) {
        const container = document.getElementById('tajweedNotes');
        let html = '';

        notes.forEach(note => {
            html += '<div class="flex items-start gap-3 bg-quran-950/30 rounded-lg px-4 py-3">';
            html += '<i class="fas fa-comment-dots text-gold-500 mt-1"></i>';
            html += '<p class="text-green-300/80 text-sm font-cairo">' + escapeHtml(note) + '</p>';
            html += '</div>';
        });

        container.innerHTML = html;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function resetAll() {
        finalTranscript = '';
        interimTranscript = '';
        document.getElementById('recognizedText').textContent = '';
        document.getElementById('recognizedPreview').classList.add('hidden');
        document.getElementById('manualText').value = '';
        document.getElementById('analyzeBtn').classList.add('hidden');
        document.getElementById('resultsSection').classList.add('hidden');
        document.getElementById('recordStatus').textContent = 'اضغط للبدء بالتسجيل';
        
        // Reset score ring
        document.getElementById('scoreRing').style.strokeDashoffset = 283;

        document.getElementById('recordSection').scrollIntoView({ behavior: 'smooth' });
    }
    </script>
</body>
</html>`
}

export default app

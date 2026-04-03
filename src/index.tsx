import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/api/*', cors())

// ============= API Routes =============

app.get('/api/surahs', async (c) => {
  try {
    const res = await fetch('https://api.alquran.cloud/v1/surah')
    const data = await res.json() as any
    if (data.code === 200) {
      const surahs = data.data.map((s: any) => ({
        number: s.number, name: s.name, englishName: s.englishName,
        englishNameTranslation: s.englishNameTranslation,
        numberOfAyahs: s.numberOfAyahs, revelationType: s.revelationType
      }))
      return c.json({ success: true, surahs })
    }
    return c.json({ success: false, error: 'Failed' }, 500)
  } catch { return c.json({ success: false, error: 'API error' }, 500) }
})

// Fetch BOTH uthmani + simple text for accurate comparison
app.get('/api/surah/:number/ayahs/:from/:to', async (c) => {
  const num = c.req.param('number')
  const from = parseInt(c.req.param('from'))
  const to = parseInt(c.req.param('to'))
  try {
    const [uthmaniRes, simpleRes] = await Promise.all([
      fetch(`https://api.alquran.cloud/v1/surah/${num}/quran-uthmani`),
      fetch(`https://api.alquran.cloud/v1/surah/${num}/ar.asad`).catch(() => null)
    ])
    const uthmaniData = await uthmaniRes.json() as any
    let simpleData: any = null
    // Also fetch simple/clean text for comparison
    const simpleRes2 = await fetch(`https://api.alquran.cloud/v1/surah/${num}`)
    simpleData = await simpleRes2.json() as any

    if (uthmaniData.code === 200) {
      const ayahs = uthmaniData.data.ayahs
        .filter((a: any) => a.numberInSurah >= from && a.numberInSurah <= to)
        .map((a: any) => {
          const simpleAyah = simpleData?.data?.ayahs?.find((sa: any) => sa.numberInSurah === a.numberInSurah)
          return {
            number: a.numberInSurah,
            text: a.text, // Uthmani for display
            simpleText: simpleAyah?.text || a.text, // Simple for comparison
            globalNumber: a.number
          }
        })
      return c.json({
        success: true,
        surahName: uthmaniData.data.name,
        surahNumber: uthmaniData.data.number,
        ayahs
      })
    }
    return c.json({ success: false, error: 'Not found' }, 500)
  } catch { return c.json({ success: false, error: 'API error' }, 500) }
})

// ============= Advanced Analysis Endpoint =============
app.post('/api/analyze', async (c) => {
  try {
    const body = await c.req.json() as any
    const { recitedText, originalAyahs } = body
    if (!recitedText || !originalAyahs || !Array.isArray(originalAyahs)) {
      return c.json({ success: false, error: 'Missing fields' }, 400)
    }
    const analysis = analyzeRecitationAdvanced(recitedText, originalAyahs)
    return c.json({ success: true, analysis })
  } catch { return c.json({ success: false, error: 'Analysis error' }, 500) }
})

// ============= ADVANCED Arabic Normalization =============
function deepNormalizeArabic(text: string): string {
  let t = text
  // Remove BOM and zero-width chars
  t = t.replace(/[\uFEFF\u200B\u200C\u200D\u200E\u200F\u00A0]/g, '')
  // Remove ALL Arabic diacritics/tashkeel  
  t = t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u08D3-\u08E1\u08E3-\u08FF\uFE70-\uFE7F]/g, '')
  // Normalize hamza-alef variants → bare alef
  t = t.replace(/[\u0622\u0623\u0625\u0671\u0672\u0673\u0675]/g, '\u0627')
  // Normalize hamza variants
  t = t.replace(/[\u0624]/g, '\u0648') // hamza on waw → waw
  t = t.replace(/[\u0626]/g, '\u064A') // hamza on ya → ya
  t = t.replace(/[\u0621]/g, '') // standalone hamza → remove
  // Normalize taa marbuta → haa
  t = t.replace(/\u0629/g, '\u0647')
  // Normalize alef maqsura → yaa
  t = t.replace(/\u0649/g, '\u064A')
  // Remove tatweel (kashida)
  t = t.replace(/\u0640/g, '')
  // Normalize lam-alef ligatures
  t = t.replace(/[\uFEF5\uFEF6\uFEF7\uFEF8\uFEF9\uFEFA\uFEFB\uFEFC]/g, '\u0644\u0627')
  // Remove Quranic stop marks and sajda marks
  t = t.replace(/[\u06D6-\u06ED]/g, '')
  // Remove decorative/presentation forms (if any)
  t = t.replace(/[\uFB50-\uFDFF\uFE00-\uFE0F]/g, (match) => {
    // Keep the char but in standard form - for safety just keep it
    return match
  })
  // Collapse spaces
  t = t.replace(/\s+/g, ' ')
  return t.trim()
}

// Even deeper normalization for fuzzy matching
function ultraNormalize(word: string): string {
  let w = deepNormalizeArabic(word)
  // Remove alef at start (definite article residue "ال")
  // Don't remove - it changes meaning
  // Remove trailing haa that might be taa marbuta
  // Already handled
  // Normalize final noon + alef → noon
  // Keep as is
  return w
}

// ============= Fuzzy Word Matching =============
function charDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) { dp[i] = [i] }
  for (let j = 1; j <= n; j++) { dp[0][j] = j }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1]
      else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    }
  }
  return dp[m][n]
}

function wordSimilarity(w1: string, w2: string): number {
  if (w1 === w2) return 1.0
  const maxLen = Math.max(w1.length, w2.length)
  if (maxLen === 0) return 1.0
  const dist = charDistance(w1, w2)
  return (maxLen - dist) / maxLen
}

// Check if two words are "the same" with configurable threshold
function wordsMatch(original: string, recited: string, threshold: number = 0.78): boolean {
  const o = ultraNormalize(original)
  const r = ultraNormalize(recited)
  if (o === r) return true
  // Check without alef-lam prefix
  const oNoAl = o.replace(/^ال/, '')
  const rNoAl = r.replace(/^ال/, '')
  if (oNoAl === rNoAl && oNoAl.length > 1) return true
  if (o === rNoAl || oNoAl === r) return true
  // Fuzzy match
  return wordSimilarity(o, r) >= threshold
}

// ============= Advanced Word-Level Diff (Weighted) =============
function advancedWordDiff(original: string[], recited: string[]): any[] {
  const m = original.length, n = recited.length
  
  // Cost matrix with fuzzy matching
  const MATCH = 0, SUB = 1, INS = 1, DEL = 1
  const FUZZY_MATCH = 0.3 // partial credit for fuzzy match
  
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  const op: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0)) // operation type
  
  for (let i = 0; i <= m; i++) dp[i][0] = i * DEL
  for (let j = 0; j <= n; j++) dp[0][j] = j * INS
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const oWord = ultraNormalize(original[i-1])
      const rWord = ultraNormalize(recited[j-1])
      
      let matchCost: number
      if (oWord === rWord) {
        matchCost = MATCH
      } else if (wordsMatch(original[i-1], recited[j-1], 0.78)) {
        matchCost = FUZZY_MATCH // almost match
      } else {
        matchCost = SUB
      }
      
      const costs = [
        dp[i-1][j-1] + matchCost,  // match/substitute
        dp[i-1][j] + DEL,           // deletion
        dp[i][j-1] + INS            // insertion
      ]
      
      dp[i][j] = Math.min(...costs)
      op[i][j] = costs.indexOf(dp[i][j]) // 0=diag, 1=up, 2=left
    }
  }
  
  // Backtrack
  const result: any[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && op[i][j] === 0) {
      const oWord = ultraNormalize(original[i-1])
      const rWord = ultraNormalize(recited[j-1])
      const sim = wordSimilarity(oWord, rWord)
      
      if (oWord === rWord || sim >= 0.78) {
        result.unshift({
          type: 'correct',
          original: original[i-1],
          recited: recited[j-1],
          similarity: Math.round(sim * 100),
          fuzzy: oWord !== rWord
        })
      } else {
        result.unshift({
          type: 'substitution',
          original: original[i-1],
          recited: recited[j-1],
          similarity: Math.round(sim * 100)
        })
      }
      i--; j--
    } else if (i > 0 && (j === 0 || op[i][j] === 1)) {
      result.unshift({ type: 'deletion', original: original[i-1], recited: null })
      i--
    } else {
      result.unshift({ type: 'insertion', original: null, recited: recited[j-1] })
      j--
    }
  }
  return result
}

// ============= Smart Per-Ayah Alignment =============
function alignRecitedToAyahs(recitedWords: string[], ayahs: { number: number, text: string, simpleText?: string }[]) {
  const results: any[] = []
  let recIdx = 0

  for (const ayah of ayahs) {
    const ayahText = ayah.simpleText || ayah.text
    const ayahNormWords = deepNormalizeArabic(ayahText).split(' ').filter(w => w.length > 0)
    const ayahWordCount = ayahNormWords.length
    
    // Try different window sizes to find best match
    let bestScore = -1
    let bestEnd = recIdx + ayahWordCount
    
    // Search range: from exact length to +/- 40% 
    const minLen = Math.max(1, Math.floor(ayahWordCount * 0.6))
    const maxLen = Math.min(recitedWords.length - recIdx, Math.ceil(ayahWordCount * 1.4))
    
    for (let tryLen = minLen; tryLen <= maxLen; tryLen++) {
      const tryWords = recitedWords.slice(recIdx, recIdx + tryLen)
      const score = computeAlignmentScore(ayahNormWords, tryWords)
      if (score > bestScore) {
        bestScore = score
        bestEnd = recIdx + tryLen
      }
    }
    
    // If no good match found, use expected length
    if (bestScore < 0.2) {
      bestEnd = Math.min(recIdx + ayahWordCount, recitedWords.length)
    }
    
    const matchedWords = recitedWords.slice(recIdx, bestEnd)
    const diff = advancedWordDiff(ayahNormWords, matchedWords)
    const correct = diff.filter(d => d.type === 'correct').length
    const total = ayahNormWords.length
    const similarity = total > 0 ? Math.round((correct / total) * 100) : 0
    
    results.push({
      ayahNumber: ayah.number,
      originalText: ayah.text,
      simpleText: ayah.simpleText || ayah.text,
      similarity,
      wordCount: total,
      correctCount: correct,
      diff,
      status: similarity >= 85 ? 'correct' : similarity >= 55 ? 'partial' : 'error'
    })
    
    recIdx = bestEnd
  }
  
  return results
}

function computeAlignmentScore(original: string[], recited: string[]): number {
  if (recited.length === 0) return 0
  let matches = 0
  const usedJ = new Set<number>()
  
  for (const oWord of original) {
    const oNorm = ultraNormalize(oWord)
    let bestJ = -1, bestSim = 0
    
    for (let j = 0; j < recited.length; j++) {
      if (usedJ.has(j)) continue
      const rNorm = ultraNormalize(recited[j])
      const sim = wordSimilarity(oNorm, rNorm)
      if (sim > bestSim) { bestSim = sim; bestJ = j }
    }
    
    if (bestSim >= 0.75 && bestJ >= 0) {
      matches++
      usedJ.add(bestJ)
    }
  }
  
  return original.length > 0 ? matches / original.length : 0
}

// ============= Main Analysis Function =============
interface AyahData { number: number; text: string; simpleText?: string }

function analyzeRecitationAdvanced(recitedText: string, originalAyahs: AyahData[]) {
  // Normalize recited text
  const normRecited = deepNormalizeArabic(recitedText)
  const recitedWords = normRecited.split(' ').filter(w => w.length > 0)
  
  // Build full original from simple text
  const fullOriginalSimple = originalAyahs.map(a => a.simpleText || a.text).join(' ')
  const fullOriginalUthmani = originalAyahs.map(a => a.text).join(' ')
  const normOriginal = deepNormalizeArabic(fullOriginalSimple)
  const originalWords = normOriginal.split(' ').filter(w => w.length > 0)
  
  // Global word diff
  const wordDiff = advancedWordDiff(originalWords, recitedWords)
  
  // Count results
  const totalWords = originalWords.length
  const correctWords = wordDiff.filter(d => d.type === 'correct').length
  const fuzzyCorrect = wordDiff.filter(d => d.type === 'correct' && d.fuzzy).length
  const exactCorrect = correctWords - fuzzyCorrect
  const substitutions = wordDiff.filter(d => d.type === 'substitution')
  const insertions = wordDiff.filter(d => d.type === 'insertion')
  const deletions = wordDiff.filter(d => d.type === 'deletion')
  
  const accuracy = totalWords > 0 ? Math.round((correctWords / totalWords) * 100) : 0
  
  // Character-level similarity
  const cDist = charDistance(normRecited, normOriginal)
  const cMax = Math.max(normRecited.length, normOriginal.length)
  const charSimilarity = cMax > 0 ? Math.round(((cMax - cDist) / cMax) * 100) : 0
  
  // Per-ayah analysis with smart alignment
  const ayahAnalysis = alignRecitedToAyahs(recitedWords, originalAyahs)
  
  // Generate detailed notes
  const notes = generateDetailedNotes(wordDiff, substitutions, deletions, insertions, accuracy)
  
  // Grade
  let grade = '', gradeClass = '', gradeIcon = ''
  if (accuracy >= 95) { grade = 'ممتاز - ما شاء الله تبارك الله'; gradeClass = 'excellent'; gradeIcon = 'star' }
  else if (accuracy >= 85) { grade = 'جيد جداً - أحسنت'; gradeClass = 'very-good'; gradeIcon = 'thumbs-up' }
  else if (accuracy >= 70) { grade = 'جيد - يحتاج مراجعة بعض المواضع'; gradeClass = 'good'; gradeIcon = 'book-open' }
  else if (accuracy >= 50) { grade = 'مقبول - يحتاج تحسين ومراجعة'; gradeClass = 'acceptable'; gradeIcon = 'pen' }
  else { grade = 'يحتاج إعادة المحاولة والممارسة'; gradeClass = 'needs-work'; gradeIcon = 'redo' }

  return {
    accuracy, charSimilarity, grade, gradeClass, gradeIcon,
    totalWords, correctWords, exactCorrect, fuzzyCorrect,
    errors: {
      substitutions: substitutions.length,
      insertions: insertions.length,
      deletions: deletions.length,
      total: substitutions.length + insertions.length + deletions.length
    },
    wordDiff,
    ayahAnalysis,
    tajweedNotes: notes,
    originalText: fullOriginalUthmani,
    recitedText: recitedText
  }
}

function generateDetailedNotes(wordDiff: any[], subs: any[], dels: any[], ins: any[], accuracy: number): string[] {
  const notes: string[] = []
  
  if (accuracy >= 95) {
    notes.push('ما شاء الله! تلاوة ممتازة ومطابقة للنص القرآني.')
    if (accuracy < 100) {
      notes.push('هناك اختلافات طفيفة جداً - قد تكون بسبب التعرف الصوتي.')
    }
  }
  
  if (subs.length > 0) {
    notes.push(`تم رصد ${subs.length} كلمة مختلفة عن النص الأصلي:`)
    for (const s of subs.slice(0, 8)) {
      if (s.original && s.recited) {
        const sim = s.similarity || 0
        if (sim >= 60) {
          notes.push(`  - "${s.recited}" ← الصحيح: "${s.original}" (تشابه ${sim}% - خطأ طفيف في النطق)`)
        } else {
          notes.push(`  - "${s.recited}" ← الصحيح: "${s.original}" (كلمة مختلفة)`)
        }
      }
    }
  }
  
  if (dels.length > 0) {
    const missingWords = dels.map(d => d.original).filter(Boolean).slice(0, 8)
    notes.push(`تم حذف/تخطي ${dels.length} كلمة:`)
    notes.push(`  الكلمات: ${missingWords.join(' ، ')}`)
    notes.push('  نصيحة: حاول القراءة بتمهل وتأكد من قراءة كل كلمة.')
  }
  
  if (ins.length > 0) {
    const extraWords = ins.map(d => d.recited).filter(Boolean).slice(0, 5)
    notes.push(`تم إضافة ${ins.length} كلمة غير موجودة في النص:`)
    notes.push(`  الكلمات الزائدة: ${extraWords.join(' ، ')}`)
  }
  
  if (accuracy < 95 && accuracy >= 50) {
    notes.push('نصائح للتحسين:')
    notes.push('  - اقرأ الآيات ببطء وتأنٍّ قبل التسجيل.')
    notes.push('  - ركّز على الكلمات المحددة باللون الأحمر والبرتقالي.')
    notes.push('  - استمع لقارئ متقن مثل الشيخ المنشاوي أو الحصري ثم حاول مرة أخرى.')
  }
  
  if (accuracy < 50) {
    notes.push('يبدو أن هناك فرقاً كبيراً - تأكد من:')
    notes.push('  - أنك تقرأ الآيات الصحيحة المعروضة على الشاشة.')
    notes.push('  - أن الميكروفون يعمل بشكل جيد والمكان هادئ.')
    notes.push('  - جرّب الكتابة اليدوية إذا كان التعرف الصوتي غير دقيق.')
  }
  
  return notes
}

// ============= Main Page =============
app.get('/', (c) => c.html(getHTML()))

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>مُصحِّح التلاوة - تصحيح تلاوة القرآن الكريم</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=Cairo:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script>
tailwind.config={theme:{extend:{colors:{gold:{50:'#fefce8',100:'#fef9c3',200:'#fef08a',300:'#fde047',400:'#facc15',500:'#eab308',600:'#ca8a04',700:'#a16207',800:'#854d0e',900:'#713f12'},qr:{50:'#f0fdf4',100:'#dcfce7',200:'#bbf7d0',300:'#86efac',400:'#4ade80',500:'#22c55e',600:'#16a34a',700:'#15803d',800:'#166534',900:'#14532d',950:'#052e16'}},fontFamily:{amiri:['Amiri Quran','Amiri','serif'],cairo:['Cairo','sans-serif']}}}}
</script>
<style>
*{box-sizing:border-box}
body{font-family:'Cairo',sans-serif;background:linear-gradient(135deg,#052e16 0%,#14532d 30%,#166534 60%,#052e16 100%);min-height:100vh}
.qtext{font-family:'Amiri Quran','Amiri',serif;font-size:1.65rem;line-height:2.8}
.ayah-num{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;background:linear-gradient(135deg,#ca8a04,#eab308);color:#052e16;border-radius:50%;font-size:0.7rem;font-weight:700;margin:0 3px;vertical-align:middle;font-family:'Cairo',sans-serif}
.glass{background:rgba(255,255,255,0.06);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1)}
.w-ok{color:#22c55e;background:rgba(34,197,94,0.12);padding:2px 5px;border-radius:4px;display:inline-block;margin:1px}
.w-fuzzy{color:#86efac;background:rgba(34,197,94,0.08);padding:2px 5px;border-radius:4px;display:inline-block;margin:1px;border-bottom:1px dotted #86efac}
.w-err{color:#ef4444;background:rgba(239,68,68,0.15);padding:2px 5px;border-radius:4px;display:inline-block;margin:1px;position:relative}
.w-err .w-fix{position:absolute;top:-1.4em;right:0;font-size:0.6em;color:#fbbf24;white-space:nowrap;font-family:'Cairo'}
.w-miss{color:#f97316;background:rgba(249,115,22,0.15);padding:2px 5px;border-radius:4px;display:inline-block;margin:1px;border-bottom:2px dashed #f97316}
.w-extra{color:#a855f7;background:rgba(168,85,247,0.12);padding:2px 5px;border-radius:4px;display:inline-block;margin:1px;text-decoration:line-through;text-decoration-color:rgba(168,85,247,0.5)}
.rec-pulse{animation:pulse 1.5s cubic-bezier(.215,.61,.355,1) infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)}70%{box-shadow:0 0 0 20px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
.wave{display:flex;align-items:center;gap:3px;height:40px}
.wave i{width:4px;background:#ef4444;border-radius:2px;animation:wv 1s ease-in-out infinite}
.wave i:nth-child(1){animation-delay:0s}.wave i:nth-child(2){animation-delay:.1s}.wave i:nth-child(3){animation-delay:.2s}.wave i:nth-child(4){animation-delay:.3s}.wave i:nth-child(5){animation-delay:.15s}.wave i:nth-child(6){animation-delay:.25s}.wave i:nth-child(7){animation-delay:.05s}
@keyframes wv{0%,100%{height:8px}50%{height:36px}}
.ornament{background-image:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ca8a04' fill-opacity='0.06'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")}
.score-ring{transition:stroke-dashoffset 1.2s ease-in-out}
.fade-in{animation:fi .4s ease}
@keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.live-word{display:inline-block;padding:2px 4px;margin:1px;border-radius:4px;transition:all 0.3s}
.live-word.pending{color:rgba(255,255,255,0.35)}
.live-word.active{color:#facc15;background:rgba(250,204,21,0.15);transform:scale(1.05)}
.live-word.done-ok{color:#22c55e;background:rgba(34,197,94,0.1)}
.live-word.done-err{color:#ef4444;background:rgba(239,68,68,0.12)}
.live-word.done-skip{color:#f97316;background:rgba(249,115,22,0.1)}
</style>
</head>
<body class="ornament">
<header class="glass border-b border-gold-700/30">
<div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
<div class="flex items-center gap-3">
<div class="w-11 h-11 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center shadow-lg">
<i class="fas fa-book-quran text-lg text-qr-950"></i>
</div>
<div>
<h1 class="text-lg font-bold text-gold-400 font-cairo">مُصحِّح التلاوة</h1>
<p class="text-[10px] text-green-300/60">تصحيح تلاوة القرآن الكريم بدقة عالية</p>
</div>
</div>
<div class="flex gap-2">
<span id="modeIndicator" class="px-3 py-1 rounded-full glass text-gold-400 text-xs font-cairo hidden">
<i class="fas fa-bolt ml-1"></i> تتبع فوري
</span>
</div>
</div>
</header>

<main class="max-w-5xl mx-auto px-4 py-6 space-y-5">

<!-- Step 1 -->
<section class="glass rounded-2xl p-5 fade-in">
<div class="flex items-center gap-2 mb-3">
<span class="w-7 h-7 rounded-lg bg-gold-600 flex items-center justify-center text-white text-xs font-bold">1</span>
<h2 class="text-base font-bold text-gold-400 font-cairo">اختر السورة والآيات</h2>
</div>
<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
<div class="md:col-span-2">
<label class="block text-green-300/70 text-xs mb-1 font-cairo">السورة</label>
<select id="surahSel" class="w-full bg-qr-950/50 text-white border border-gold-700/30 rounded-xl px-3 py-2.5 font-cairo text-sm focus:outline-none focus:border-gold-500" onchange="onSurahChange()">
<option value="">-- اختر السورة --</option>
</select>
</div>
<div>
<label class="block text-green-300/70 text-xs mb-1 font-cairo">من آية</label>
<input type="number" id="ayFrom" min="1" value="1" class="w-full bg-qr-950/50 text-white border border-gold-700/30 rounded-xl px-3 py-2.5 font-cairo text-sm focus:outline-none focus:border-gold-500">
</div>
<div>
<label class="block text-green-300/70 text-xs mb-1 font-cairo">إلى آية</label>
<input type="number" id="ayTo" min="1" value="7" class="w-full bg-qr-950/50 text-white border border-gold-700/30 rounded-xl px-3 py-2.5 font-cairo text-sm focus:outline-none focus:border-gold-500">
</div>
</div>
<div class="flex items-center gap-3 mt-3">
<button id="loadBtn" onclick="loadAyahs()" class="bg-gradient-to-l from-gold-600 to-gold-700 hover:from-gold-500 hover:to-gold-600 text-qr-950 font-bold py-2.5 px-6 rounded-xl font-cairo text-sm transition-all flex items-center gap-2">
<i class="fas fa-book-open"></i> عرض الآيات
</button>
<label class="flex items-center gap-2 text-green-300/60 text-xs font-cairo cursor-pointer">
<input type="checkbox" id="liveMode" checked class="accent-gold-500 w-4 h-4"> تفعيل التتبع الفوري أثناء القراءة
</label>
</div>
</section>

<!-- Quran Display + Live Tracking -->
<section id="quranBox" class="hidden glass rounded-2xl p-5 fade-in">
<div class="flex items-center justify-between mb-3">
<div class="flex items-center gap-2">
<span class="w-7 h-7 rounded-lg bg-gold-600 flex items-center justify-center text-white text-xs font-bold">2</span>
<h2 class="text-base font-bold text-gold-400 font-cairo">النص القرآني</h2>
</div>
<span id="surahTitle" class="text-gold-500 font-amiri text-base"></span>
</div>
<div class="bg-qr-950/40 rounded-xl p-5 border border-gold-700/20">
<div id="bismillah" class="font-amiri text-xl text-gold-500 text-center mb-3"></div>
<div id="liveContainer" class="qtext text-white text-center leading-[3]"></div>
</div>
<p class="text-green-300/50 text-[10px] mt-2 text-center font-cairo">
<i class="fas fa-info-circle ml-1"></i>
في وضع التتبع الفوري: الكلمات تتلوّن مباشرة أثناء قراءتك
</p>
</section>

<!-- Step 3: Record -->
<section id="recSection" class="hidden glass rounded-2xl p-5 fade-in">
<div class="flex items-center gap-2 mb-3">
<span class="w-7 h-7 rounded-lg bg-gold-600 flex items-center justify-center text-white text-xs font-bold">3</span>
<h2 class="text-base font-bold text-gold-400 font-cairo">سجّل تلاوتك</h2>
</div>
<div class="text-center space-y-3">
<button id="recBtn" onclick="toggleRec()" class="w-20 h-20 rounded-full bg-gradient-to-br from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 text-white text-2xl shadow-2xl transition-all mx-auto flex items-center justify-center">
<i class="fas fa-microphone"></i>
</button>
<p id="recStatus" class="text-green-300/60 text-xs font-cairo">اضغط لبدء التسجيل</p>
<div id="waveBox" class="hidden justify-center"><div class="wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>

<div id="recPreview" class="hidden bg-qr-950/40 rounded-xl p-3 border border-gold-700/20 text-right">
<p class="text-[10px] text-gold-500/60 mb-1 font-cairo"><i class="fas fa-language ml-1"></i> النص المُتعرَّف عليه:</p>
<p id="recText" class="qtext text-white text-base"></p>
</div>

<div class="border-t border-gold-700/20 pt-3 mt-3">
<button onclick="toggleManual()" class="text-gold-400 text-xs font-cairo hover:text-gold-300 transition-colors">
<i class="fas fa-keyboard ml-1"></i> أو اكتب التلاوة يدوياً
</button>
<div id="manualBox" class="hidden mt-2">
<textarea id="manualTxt" rows="3" class="w-full bg-qr-950/50 text-white border border-gold-700/30 rounded-xl px-3 py-2 font-amiri text-base focus:outline-none focus:border-gold-500 resize-none text-right" placeholder="اكتب التلاوة هنا..."></textarea>
</div>
</div>

<button id="analyzeBtn" onclick="doAnalyze()" class="hidden bg-gradient-to-l from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-bold py-2.5 px-8 rounded-xl font-cairo text-sm transition-all shadow-lg">
<i class="fas fa-magnifying-glass-chart ml-2"></i> تحليل التلاوة
</button>
</div>
</section>

<!-- Loading -->
<div id="loadingBox" class="hidden text-center py-10">
<i class="fas fa-spinner fa-spin text-gold-400 text-3xl"></i>
<p class="text-green-300/60 mt-2 font-cairo text-sm">جاري التحليل المتقدم...</p>
</div>

<!-- Results -->
<section id="results" class="hidden space-y-5 fade-in">

<!-- Score -->
<div class="glass rounded-2xl p-5">
<div class="flex items-center gap-2 mb-4">
<span class="w-7 h-7 rounded-lg bg-gold-600 flex items-center justify-center text-white text-xs font-bold">4</span>
<h2 class="text-base font-bold text-gold-400 font-cairo">نتيجة التقييم</h2>
</div>
<div class="grid grid-cols-1 md:grid-cols-3 gap-5">
<div class="flex flex-col items-center">
<div class="relative w-36 h-36">
<svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.08)" stroke-width="7" fill="none"/>
<circle id="scoreRing" cx="50" cy="50" r="45" stroke="#22c55e" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="283" class="score-ring"/>
</svg>
<div class="absolute inset-0 flex flex-col items-center justify-center">
<span id="scorePct" class="text-3xl font-bold text-white">0%</span>
<span class="text-[10px] text-green-300/50 font-cairo">الدقة</span>
</div>
</div>
<p id="gradeText" class="mt-2 text-sm font-bold font-cairo text-gold-400 text-center"></p>
</div>
<div class="space-y-2">
<h3 class="text-gold-500 font-cairo font-semibold text-sm mb-2"><i class="fas fa-chart-bar ml-1"></i> إحصائيات</h3>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5"><span class="text-green-300/60 text-xs font-cairo">إجمالي الكلمات</span><span id="sTotal" class="text-white font-bold text-sm">0</span></div>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5"><span class="text-green-300/60 text-xs font-cairo">صحيح (مطابق)</span><span id="sExact" class="text-green-400 font-bold text-sm">0</span></div>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5"><span class="text-green-300/60 text-xs font-cairo">صحيح (تقريبي)</span><span id="sFuzzy" class="text-green-300 font-bold text-sm">0</span></div>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5"><span class="text-green-300/60 text-xs font-cairo">التشابه الحرفي</span><span id="sChar" class="text-gold-400 font-bold text-sm">0%</span></div>
</div>
<div class="space-y-2">
<h3 class="text-gold-500 font-cairo font-semibold text-sm mb-2"><i class="fas fa-triangle-exclamation ml-1"></i> الأخطاء</h3>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5"><span class="text-green-300/60 text-xs font-cairo flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-red-500"></span>كلمات خاطئة</span><span id="sSub" class="text-red-400 font-bold text-sm">0</span></div>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5"><span class="text-green-300/60 text-xs font-cairo flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-orange-500"></span>كلمات محذوفة</span><span id="sDel" class="text-orange-400 font-bold text-sm">0</span></div>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5"><span class="text-green-300/60 text-xs font-cairo flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-purple-500"></span>كلمات زائدة</span><span id="sIns" class="text-purple-400 font-bold text-sm">0</span></div>
<div class="flex justify-between bg-qr-950/30 rounded-lg px-3 py-1.5 border border-gold-700/20"><span class="text-gold-400/80 text-xs font-cairo font-semibold">إجمالي الأخطاء</span><span id="sErrTot" class="text-red-400 font-bold text-sm">0</span></div>
</div>
</div>
</div>

<!-- Comparison -->
<div class="glass rounded-2xl p-5">
<h3 class="text-gold-400 font-cairo font-bold text-sm mb-3 flex items-center gap-2"><i class="fas fa-code-compare"></i> المقارنة التفصيلية كلمة بكلمة</h3>
<div class="bg-qr-950/40 rounded-xl p-5 border border-gold-700/20">
<div id="compView" class="qtext text-base leading-[3] text-right"></div>
</div>
<div class="flex flex-wrap gap-3 mt-3 justify-center">
<span class="flex items-center gap-1 text-[10px] font-cairo"><span class="w-2.5 h-2.5 rounded bg-green-500"></span><span class="text-green-300/60">صحيح</span></span>
<span class="flex items-center gap-1 text-[10px] font-cairo"><span class="w-2.5 h-2.5 rounded bg-green-300"></span><span class="text-green-300/60">صحيح (تقريبي)</span></span>
<span class="flex items-center gap-1 text-[10px] font-cairo"><span class="w-2.5 h-2.5 rounded bg-red-500"></span><span class="text-green-300/60">خطأ</span></span>
<span class="flex items-center gap-1 text-[10px] font-cairo"><span class="w-2.5 h-2.5 rounded bg-orange-500"></span><span class="text-green-300/60">محذوف</span></span>
<span class="flex items-center gap-1 text-[10px] font-cairo"><span class="w-2.5 h-2.5 rounded bg-purple-500"></span><span class="text-green-300/60">زائد</span></span>
</div>
</div>

<!-- Per Ayah -->
<div class="glass rounded-2xl p-5">
<h3 class="text-gold-400 font-cairo font-bold text-sm mb-3 flex items-center gap-2"><i class="fas fa-list-check"></i> تحليل كل آية</h3>
<div id="ayahBox" class="space-y-2"></div>
</div>

<!-- Notes -->
<div class="glass rounded-2xl p-5">
<h3 class="text-gold-400 font-cairo font-bold text-sm mb-3 flex items-center gap-2"><i class="fas fa-lightbulb"></i> ملاحظات وتوجيهات</h3>
<div id="notesBox" class="space-y-1.5"></div>
</div>

<!-- Retry -->
<div class="text-center">
<button onclick="resetAll()" class="bg-gradient-to-l from-gold-600 to-gold-700 hover:from-gold-500 hover:to-gold-600 text-qr-950 font-bold py-2.5 px-8 rounded-xl font-cairo text-sm transition-all shadow-lg">
<i class="fas fa-redo ml-2"></i> إعادة المحاولة
</button>
</div>
</section>
</main>

<footer class="glass border-t border-gold-700/30 mt-10 py-4">
<div class="max-w-5xl mx-auto px-4 text-center">
<p class="text-green-300/40 text-[10px] font-cairo">مُصحِّح التلاوة - تصحيح تلاوة القرآن الكريم بدقة عالية باستخدام خوارزميات المطابقة الذكية</p>
</div>
</footer>

<script>
// ====== State ======
let surahs=[],currentAyahs=[],currentSurahNum=0,isRec=false,recognition=null,finalTx='',interimTx='';
let liveWords=[],liveWordIdx=0,liveActive=false;

// ====== Arabic Normalization (Client-side mirror) ======
function norm(t){
  return t.replace(/[\\uFEFF\\u200B-\\u200F\\u00A0]/g,'')
    .replace(/[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06DC\\u06DF-\\u06E8\\u06EA-\\u06ED\\u08D3-\\u08E1\\u08E3-\\u08FF\\uFE70-\\uFE7F]/g,'')
    .replace(/[\\u0622\\u0623\\u0625\\u0671\\u0672\\u0673\\u0675]/g,'\\u0627')
    .replace(/[\\u0624]/g,'\\u0648')
    .replace(/[\\u0626]/g,'\\u064A')
    .replace(/[\\u0621]/g,'')
    .replace(/\\u0629/g,'\\u0647')
    .replace(/\\u0649/g,'\\u064A')
    .replace(/\\u0640/g,'')
    .replace(/[\\uFEF5-\\uFEFC]/g,'\\u0644\\u0627')
    .replace(/\\s+/g,' ').trim();
}

function wordSim(a,b){
  if(a===b)return 1;
  const m=a.length,n=b.length;
  if(!m)return n?0:1;if(!n)return 0;
  const dp=[];
  for(let i=0;i<=m;i++){dp[i]=[i]}
  for(let j=1;j<=n;j++){dp[0][j]=j}
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  }
  return(Math.max(m,n)-dp[m][n])/Math.max(m,n);
}

function wordsMatch(a,b,th){
  th=th||0.78;
  const na=norm(a),nb=norm(b);
  if(na===nb)return true;
  const na2=na.replace(/^\\u0627\\u0644/,''),nb2=nb.replace(/^\\u0627\\u0644/,'');
  if(na2===nb2&&na2.length>1)return true;
  if(na===nb2||na2===nb)return true;
  return wordSim(na,nb)>=th;
}

// ====== Init ======
document.addEventListener('DOMContentLoaded',()=>{loadSurahs();initSpeech()});

async function loadSurahs(){
  try{
    const r=await fetch('/api/surahs'),d=await r.json();
    if(d.success){
      surahs=d.surahs;
      const sel=document.getElementById('surahSel');
      surahs.forEach(s=>{const o=document.createElement('option');o.value=s.number;o.textContent=s.number+' - '+s.name+' ('+s.englishName+') - '+s.numberOfAyahs+' آية';sel.appendChild(o)});
    }
  }catch(e){console.error(e)}
}

function onSurahChange(){
  const n=+document.getElementById('surahSel').value;if(!n)return;
  const s=surahs.find(x=>x.number===n);
  if(s){document.getElementById('ayFrom').value=1;document.getElementById('ayTo').value=Math.min(s.numberOfAyahs,10);document.getElementById('ayTo').max=s.numberOfAyahs;document.getElementById('ayFrom').max=s.numberOfAyahs}
}

async function loadAyahs(){
  const sn=document.getElementById('surahSel').value,fr=+document.getElementById('ayFrom').value,to=+document.getElementById('ayTo').value;
  if(!sn||!fr||!to)return;
  if(fr>to){alert('رقم آية البداية أكبر من النهاية');return}
  currentSurahNum=+sn;
  try{
    document.getElementById('loadBtn').innerHTML='<i class="fas fa-spinner fa-spin ml-1"></i> تحميل...';
    const r=await fetch('/api/surah/'+sn+'/ayahs/'+fr+'/'+to),d=await r.json();
    if(d.success){
      currentAyahs=d.ayahs;
      displayQuran(d);
      document.getElementById('quranBox').classList.remove('hidden');
      document.getElementById('recSection').classList.remove('hidden');
      document.getElementById('results').classList.add('hidden');
      resetLiveTracking();
      document.getElementById('quranBox').scrollIntoView({behavior:'smooth'});
    }
  }catch(e){alert('خطأ في التحميل')}
  finally{document.getElementById('loadBtn').innerHTML='<i class="fas fa-book-open ml-1"></i> عرض الآيات'}
}

function displayQuran(d){
  document.getElementById('surahTitle').textContent=d.surahName||'';
  const bism=document.getElementById('bismillah');
  if(currentSurahNum!==1&&currentSurahNum!==9&&+document.getElementById('ayFrom').value===1)
    bism.textContent='\\u0628\\u0650\\u0633\\u0652\\u0645\\u0650 \\u0671\\u0644\\u0644\\u0651\\u064E\\u0647\\u0650 \\u0671\\u0644\\u0631\\u0651\\u064E\\u062D\\u0652\\u0645\\u064E\\u0670\\u0646\\u0650 \\u0671\\u0644\\u0631\\u0651\\u064E\\u062D\\u0650\\u064A\\u0645\\u0650';
  else bism.textContent='';
  
  // Build live-tracking word spans
  const container=document.getElementById('liveContainer');
  let html='';
  liveWords=[];
  d.ayahs.forEach((a,ai)=>{
    const words=a.text.split(/\\s+/).filter(w=>w.length>0);
    words.forEach((w,wi)=>{
      const id='lw-'+ai+'-'+wi;
      liveWords.push({id,word:w,ayahIdx:ai,wordIdx:wi,simpleWord:a.simpleText?norm(a.simpleText).split(' ').filter(x=>x)[wi]||norm(w):norm(w)});
      html+='<span id="'+id+'" class="live-word pending qtext">'+esc(w)+'</span> ';
    });
    html+='<span class="ayah-num">'+a.number+'</span> ';
  });
  container.innerHTML=html;
  liveWordIdx=0;
}

function resetLiveTracking(){
  liveWordIdx=0;liveActive=false;
  liveWords.forEach(lw=>{
    const el=document.getElementById(lw.id);
    if(el){el.className='live-word pending qtext'}
  });
}

// ====== Live Tracking ======
function processLiveWord(spokenWord){
  if(!document.getElementById('liveMode').checked)return;
  if(liveWordIdx>=liveWords.length)return;
  
  const nSpoken=norm(spokenWord);
  if(!nSpoken)return;
  
  // Try to match current or next few words (handles speech recognition grouping)
  let bestIdx=-1,bestSim=0;
  const searchRange=Math.min(liveWordIdx+4,liveWords.length);
  
  for(let i=liveWordIdx;i<searchRange;i++){
    const sim=wordSim(norm(liveWords[i].simpleWord||liveWords[i].word),nSpoken);
    // Also try without al-
    const sim2=wordSim(norm(liveWords[i].simpleWord||liveWords[i].word).replace(/^\\u0627\\u0644/,''),nSpoken.replace(/^\\u0627\\u0644/,''));
    const best=Math.max(sim,sim2);
    if(best>bestSim){bestSim=best;bestIdx=i}
  }
  
  if(bestSim>=0.65&&bestIdx>=0){
    // Mark skipped words
    for(let i=liveWordIdx;i<bestIdx;i++){
      const el=document.getElementById(liveWords[i].id);
      if(el)el.className='live-word done-skip qtext';
    }
    // Mark matched word
    const el=document.getElementById(liveWords[bestIdx].id);
    if(el)el.className='live-word done-ok qtext';
    liveWordIdx=bestIdx+1;
    // Highlight next word
    if(liveWordIdx<liveWords.length){
      const next=document.getElementById(liveWords[liveWordIdx].id);
      if(next){next.className='live-word active qtext';next.scrollIntoView({behavior:'smooth',block:'center'})}
    }
  } else if(bestSim>=0.4&&bestIdx>=0){
    // Partial match - mark as error
    for(let i=liveWordIdx;i<bestIdx;i++){
      const el=document.getElementById(liveWords[i].id);
      if(el)el.className='live-word done-skip qtext';
    }
    const el=document.getElementById(liveWords[bestIdx].id);
    if(el)el.className='live-word done-err qtext';
    liveWordIdx=bestIdx+1;
    if(liveWordIdx<liveWords.length){
      const next=document.getElementById(liveWords[liveWordIdx].id);
      if(next){next.className='live-word active qtext';next.scrollIntoView({behavior:'smooth',block:'center'})}
    }
  }
}

// ====== Speech Recognition ======
function initSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){document.getElementById('recBtn').title='غير مدعوم';document.getElementById('recStatus').textContent='المتصفح لا يدعم التعرف الصوتي - استخدم الإدخال اليدوي';document.getElementById('manualBox').classList.remove('hidden');return}
  recognition=new SR();
  recognition.lang='ar-SA';
  recognition.continuous=true;
  recognition.interimResults=true;
  recognition.maxAlternatives=3;

  recognition.onresult=(e)=>{
    interimTx='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const transcript=e.results[i][0].transcript;
      if(e.results[i].isFinal){
        finalTx+=transcript+' ';
        // Process each word for live tracking
        const words=transcript.split(/\\s+/).filter(w=>w.trim());
        words.forEach(w=>processLiveWord(w));
      } else {
        interimTx+=transcript;
      }
    }
    document.getElementById('recText').textContent=finalTx+interimTx;
    document.getElementById('recPreview').classList.remove('hidden');
    document.getElementById('analyzeBtn').classList.remove('hidden');
  };
  recognition.onerror=(e)=>{
    if(e.error==='no-speech')document.getElementById('recStatus').textContent='لم يُسمع كلام - حاول مرة أخرى';
    else if(e.error==='not-allowed')document.getElementById('recStatus').textContent='يرجى السماح بالميكروفون';
  };
  recognition.onend=()=>{if(isRec)try{recognition.start()}catch(e){}else stopRecUI()};
}

function toggleRec(){if(!recognition){toggleManual();return}isRec?stopRec():startRec()}

function startRec(){
  finalTx='';interimTx='';isRec=true;liveActive=true;
  resetLiveTracking();
  // Highlight first word
  if(liveWords.length>0){
    const el=document.getElementById(liveWords[0].id);
    if(el)el.className='live-word active qtext';
  }
  if(document.getElementById('liveMode').checked)document.getElementById('modeIndicator').classList.remove('hidden');
  try{recognition.start()}catch(e){recognition.stop();setTimeout(()=>recognition.start(),100)}
  const btn=document.getElementById('recBtn');
  btn.classList.add('rec-pulse');btn.innerHTML='<i class="fas fa-stop"></i>';
  document.getElementById('recStatus').textContent='جاري التسجيل... اقرأ الآيات';
  document.getElementById('waveBox').classList.remove('hidden');document.getElementById('waveBox').classList.add('flex');
}

function stopRec(){isRec=false;liveActive=false;if(recognition)recognition.stop();stopRecUI()}

function stopRecUI(){
  const btn=document.getElementById('recBtn');
  btn.classList.remove('rec-pulse');btn.innerHTML='<i class="fas fa-microphone"></i>';
  document.getElementById('recStatus').textContent='تم إيقاف التسجيل';
  document.getElementById('waveBox').classList.add('hidden');document.getElementById('waveBox').classList.remove('flex');
  document.getElementById('modeIndicator').classList.add('hidden');
  if(finalTx.trim())document.getElementById('analyzeBtn').classList.remove('hidden');
}

function toggleManual(){const m=document.getElementById('manualBox');m.classList.toggle('hidden');if(!m.classList.contains('hidden')){document.getElementById('analyzeBtn').classList.remove('hidden');document.getElementById('manualTxt').focus()}}

// ====== Analysis ======
async function doAnalyze(){
  let txt=finalTx.trim();
  const manual=document.getElementById('manualTxt').value.trim();
  if(manual)txt=manual;
  if(!txt){alert('لم يتم التعرف على نص - سجّل مرة أخرى أو اكتب يدوياً');return}
  if(!currentAyahs.length){alert('اختر السورة والآيات أولاً');return}
  
  document.getElementById('loadingBox').classList.remove('hidden');
  document.getElementById('results').classList.add('hidden');
  
  try{
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recitedText:txt,originalAyahs:currentAyahs})});
    const d=await r.json();
    if(d.success)showResults(d.analysis);else alert('خطأ في التحليل');
  }catch(e){alert('خطأ في الاتصال')}
  finally{document.getElementById('loadingBox').classList.add('hidden')}
}

function showResults(a){
  document.getElementById('results').classList.remove('hidden');
  
  // Score ring
  const ring=document.getElementById('scoreRing');
  const off=283-(a.accuracy/100)*283;
  ring.style.strokeDashoffset=off;
  ring.style.stroke=a.accuracy>=90?'#22c55e':a.accuracy>=70?'#eab308':a.accuracy>=50?'#f97316':'#ef4444';
  document.getElementById('scorePct').textContent=a.accuracy+'%';
  document.getElementById('gradeText').textContent=a.grade;
  
  // Stats
  document.getElementById('sTotal').textContent=a.totalWords;
  document.getElementById('sExact').textContent=a.exactCorrect;
  document.getElementById('sFuzzy').textContent=a.fuzzyCorrect;
  document.getElementById('sChar').textContent=a.charSimilarity+'%';
  document.getElementById('sSub').textContent=a.errors.substitutions;
  document.getElementById('sDel').textContent=a.errors.deletions;
  document.getElementById('sIns').textContent=a.errors.insertions;
  document.getElementById('sErrTot').textContent=a.errors.total;
  
  // Comparison
  renderComparison(a.wordDiff);
  
  // Per ayah
  renderAyahAnalysis(a.ayahAnalysis);
  
  // Notes
  renderNotes(a.tajweedNotes);
  
  document.getElementById('results').scrollIntoView({behavior:'smooth'});
}

function renderComparison(diff){
  const c=document.getElementById('compView');
  let h='';
  diff.forEach(d=>{
    switch(d.type){
      case 'correct':
        h+=d.fuzzy?'<span class="w-fuzzy" title="تقريبي '+d.similarity+'%">'+esc(d.original)+'</span> ':
          '<span class="w-ok">'+esc(d.original)+'</span> ';
        break;
      case 'substitution':
        h+='<span class="w-err" title="قرأت: '+esc(d.recited||'')+' | تشابه: '+(d.similarity||0)+'%"><span class="w-fix">'+esc(d.recited||'')+'</span>'+esc(d.original)+'</span> ';
        break;
      case 'deletion':
        h+='<span class="w-miss" title="كلمة محذوفة/لم تُقرأ">'+esc(d.original)+'</span> ';
        break;
      case 'insertion':
        h+='<span class="w-extra" title="كلمة زائدة">'+esc(d.recited||'')+'</span> ';
        break;
    }
  });
  c.innerHTML=h;
}

function renderAyahAnalysis(ayahs){
  const c=document.getElementById('ayahBox');
  let h='';
  ayahs.forEach(a=>{
    const icon=a.status==='correct'?'fa-check-circle':a.status==='partial'?'fa-exclamation-circle':'fa-times-circle';
    const clr=a.status==='correct'?'text-green-400':a.status==='partial'?'text-yellow-400':'text-red-400';
    const label=a.status==='correct'?'صحيح':a.status==='partial'?'جزئي':'يحتاج مراجعة';
    const barClr=a.similarity>=85?'#22c55e':a.similarity>=55?'#eab308':'#ef4444';
    
    h+='<div class="bg-qr-950/30 rounded-xl p-3 border border-gold-700/10">';
    h+='<div class="flex items-center justify-between mb-1">';
    h+='<div class="flex items-center gap-2"><span class="ayah-num" style="width:24px;height:24px;font-size:0.6rem">'+a.ayahNumber+'</span>';
    h+='<span class="'+clr+' text-xs font-cairo"><i class="fas '+icon+' ml-1"></i>'+label+'</span>';
    h+='<span class="text-[10px] text-green-300/40 font-cairo">('+a.correctCount+'/'+a.wordCount+' كلمة)</span></div>';
    h+='<span class="text-xs font-bold '+clr+'">'+a.similarity+'%</span></div>';
    
    // Mini word diff for this ayah
    if(a.diff&&a.diff.length>0){
      h+='<div class="qtext text-sm mt-1 text-right">';
      a.diff.forEach(d=>{
        if(d.type==='correct')h+='<span class="'+(d.fuzzy?'w-fuzzy':'w-ok')+'" style="font-size:0.85rem">'+esc(d.original)+'</span> ';
        else if(d.type==='substitution')h+='<span class="w-err" style="font-size:0.85rem">'+esc(d.original)+'</span> ';
        else if(d.type==='deletion')h+='<span class="w-miss" style="font-size:0.85rem">'+esc(d.original)+'</span> ';
        else if(d.type==='insertion')h+='<span class="w-extra" style="font-size:0.85rem">'+esc(d.recited||'')+'</span> ';
      });
      h+='</div>';
    }
    
    h+='<div class="mt-1.5 bg-gray-700/30 rounded-full h-1.5"><div class="h-1.5 rounded-full transition-all" style="width:'+a.similarity+'%;background:'+barClr+'"></div></div>';
    h+='</div>';
  });
  c.innerHTML=h;
}

function renderNotes(notes){
  const c=document.getElementById('notesBox');
  let h='';
  notes.forEach(n=>{
    const isIndented=n.startsWith('  ');
    const icon=isIndented?'fa-angle-left':'fa-comment-dots';
    const pad=isIndented?'pr-6':'';
    h+='<div class="flex items-start gap-2 bg-qr-950/30 rounded-lg px-3 py-2 '+pad+'">';
    h+='<i class="fas '+icon+' text-gold-500 mt-0.5 text-xs"></i>';
    h+='<p class="text-green-300/70 text-xs font-cairo leading-relaxed">'+esc(n)+'</p></div>';
  });
  c.innerHTML=h;
}

function esc(t){if(!t)return'';const d=document.createElement('div');d.textContent=t;return d.innerHTML}

function resetAll(){
  finalTx='';interimTx='';
  document.getElementById('recText').textContent='';
  document.getElementById('recPreview').classList.add('hidden');
  document.getElementById('manualTxt').value='';
  document.getElementById('analyzeBtn').classList.add('hidden');
  document.getElementById('results').classList.add('hidden');
  document.getElementById('recStatus').textContent='اضغط لبدء التسجيل';
  document.getElementById('scoreRing').style.strokeDashoffset=283;
  resetLiveTracking();
  document.getElementById('recSection').scrollIntoView({behavior:'smooth'});
}
</script>
</body>
</html>`
}

export default app

/**
 * 极简、安全的 Markdown 渲染：先整体转义 HTML，再处理 LLM 回复里常见的少量语法。
 * 支持：标题、粗体/斜体、行内代码、无序/有序列表、引用、段落换行。
 * 不引入第三方依赖，也不会渲染任何原始 HTML，可放心用于 v-html。
 */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const renderInline = (text: string): string =>
  text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source || '').replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
      paragraph = []
    }
  }
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushParagraph()
      closeList()
      continue
    }

    const heading = line.match(/^\s*#{1,6}\s+(.*)$/)
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const ordered = line.match(/^\s*(\d+)[.)、]\s+(.*)$/)
    const quote = line.match(/^\s*&gt;\s?(.*)$/)

    if (heading) {
      flushParagraph(); closeList()
      out.push(`<p class="md-h">${renderInline(heading[1])}</p>`)
    } else if (bullet) {
      flushParagraph()
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${renderInline(bullet[1])}</li>`)
    } else if (ordered) {
      flushParagraph()
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${renderInline(ordered[2])}</li>`)
    } else if (quote) {
      flushParagraph(); closeList()
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`)
    } else {
      closeList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  closeList()
  return out.join('')
}

/**
 * 把"1. xxx；2. xxx"或多行形式的建议文本拆成条目。
 */
export function splitSuggestions(text: string): string[] {
  const source = (text || '').trim()
  if (!source) return []
  const byLine = source.split(/\n+/).map(s => s.trim()).filter(Boolean)
  const parts = byLine.length > 1
    ? byLine
    : source.split(/(?:^|[；;。]\s*)(?=\d+[.、)]\s*)/).map(s => s.trim()).filter(Boolean)
  return parts
    .map(s => s.replace(/^\d+[.、)]\s*/, '').replace(/[；;]\s*$/, '').trim())
    .filter(Boolean)
}

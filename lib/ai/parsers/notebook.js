import { joinSections, normalizeExtractedText, toSourceString } from './normalize'

export function parseNotebook(raw, { ext, fileName } = {}) {
  let notebook
  try {
    notebook = JSON.parse(String(raw || ''))
  } catch (err) {
    const text = normalizeExtractedText(
      '[Notebook file could not be parsed as valid .ipynb JSON. The trainer should review the uploaded file directly. No uploaded code was executed.]'
    )
    return {
      text,
      diagnostics: {
        parser: 'ipynb',
        extension: ext || null,
        fileName: fileName || null,
        supported: false,
        valid_json: false,
        parse_error: err?.message || 'Invalid notebook JSON',
        code_cells: 0,
        markdown_cells: 0,
        characters: text.length,
      },
    }
  }

  const cells = Array.isArray(notebook?.cells) ? notebook.cells : []
  const parts = []
  let codeCells = 0
  let markdownCells = 0
  let skippedCells = 0
  let emptyCells = 0
  let outputCells = 0
  let errorOutputs = 0
  let warningOutputs = 0

  cells.forEach((cell, index) => {
    if (!cell || typeof cell !== 'object') {
      skippedCells++
      return
    }

    const source = toSourceString(cell.source)
    const outputs = Array.isArray(cell.outputs) ? cell.outputs : []
    const outputText = outputs.map(formatNotebookOutput).filter(Boolean).join('\n')
    if (outputs.length) outputCells++
    if (outputs.some(output => output?.output_type === 'error')) errorOutputs++
    if (/warning/i.test(outputText)) warningOutputs++
    if (!source.trim() && !outputText.trim()) {
      emptyCells++
      return
    }

    if (cell.cell_type === 'code') {
      codeCells++
      parts.push(`# Cell ${index + 1} [code]\n${source}${outputText ? `\nOutput: ${outputText}` : ''}`)
      return
    }

    if (cell.cell_type === 'markdown') {
      markdownCells++
      parts.push(`# Cell ${index + 1} [markdown]\n${source}`)
      return
    }

    skippedCells++
  })

  const text = normalizeExtractedText(
    joinSections(parts) ||
      '[Notebook parsed successfully, but no readable code or markdown cells were found. The trainer should review the uploaded file directly.]'
  )
  return {
    text,
    diagnostics: {
      parser: 'ipynb',
      extension: ext || null,
      fileName: fileName || null,
      supported: true,
      valid_json: true,
      cells: cells.length,
      code_cells: codeCells,
      markdown_cells: markdownCells,
      empty_cells: emptyCells,
      output_cells: outputCells,
      error_outputs: errorOutputs,
      warning_outputs: warningOutputs,
      skipped_cells: skippedCells,
      characters: text.length,
    },
  }
}

function formatNotebookOutput(output) {
  if (!output || typeof output !== 'object') return ''
  if (output.output_type === 'error') {
    return [output.ename, output.evalue].filter(Boolean).join(': ')
  }
  if (output.text) return toSourceString(output.text).trim()
  if (output.data?.['text/plain']) return toSourceString(output.data['text/plain']).trim()
  return ''
}

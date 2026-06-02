export function normalizeName(name) {
  return String(name || '').trim().toLowerCase()
}

export function resolveTrainerName(loginName, trainerNames = []) {
  const loginKey = normalizeName(loginName)
  if (!loginKey) return ''
  const cleanNames = trainerNames.filter(Boolean)
  const exact = cleanNames.find(name => normalizeName(name) === loginKey)
  if (exact) return exact
  const prefix = cleanNames.find(name => normalizeName(name).startsWith(`${loginKey} `))
  if (prefix) return prefix
  const contains = cleanNames.find(name => normalizeName(name).includes(` ${loginKey}`))
  return contains || loginName
}

export async function getTeacherScope(supabase, teacherName) {
  // Always fetch current batch ownership from the database. Do not cache scope here.
  const [{ data: allBatches, error: batchError }, { data: trainerRows }] = await Promise.all([
    supabase.from('batches').select('*').order('created_at'),
    supabase.from('trainers').select('name').order('created_at'),
  ])

  if (batchError) throw new Error(batchError.message)

  const trainerNames = [
    ...(allBatches || []).map(batch => batch.created_by),
    ...(trainerRows || []).map(trainer => trainer.name),
  ].filter(Boolean)
  const resolvedName = resolveTrainerName(teacherName, trainerNames)
  const teacherKey = normalizeName(resolvedName)

  const batches = (allBatches || []).filter(batch => normalizeName(batch.created_by) === teacherKey)
  const batchNames = batches.map(batch => batch.name)

  return { teacherName: resolvedName, batches, batchNames }
}

export async function getScopedTeacherData(supabase, teacherName, { includeSubmissions = true } = {}) {
  const scope = await getTeacherScope(supabase, teacherName)
  const { batchNames } = scope

  if (!batchNames.length) {
    return {
      ...scope,
      batches: [],
      students: [],
      submissions: [],
    }
  }

  const [{ data: students, error: studentError }, submissionResult] = await Promise.all([
    supabase.from('students').select('id,name,batch,created_at').in('batch', batchNames).order('created_at'),
    includeSubmissions
      ? supabase.from('submissions').select('*').in('batch', batchNames).order('submitted_at', { ascending: false })
      : supabase.from('submissions').select('student_id, batch, feedback').in('batch', batchNames),
  ])

  if (studentError) throw new Error(studentError.message)
  if (submissionResult.error) throw new Error(submissionResult.error.message)

  return {
    ...scope,
    students: students || [],
    submissions: submissionResult.data || [],
  }
}

export async function assertSubmissionInTeacherScope(supabase, teacherName, submissionId) {
  const scoped = await getTeacherScope(supabase, teacherName)
  if (!scoped.batchNames.length) {
    const error = new Error('Submission is outside this teacher scope')
    error.status = 403
    throw error
  }

  const { data: submission, error: submissionError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .in('batch', scoped.batchNames)
    .maybeSingle()

  if (submissionError) throw new Error(submissionError.message)
  if (!submission) {
    const error = new Error('Submission is outside this teacher scope')
    error.status = 403
    throw error
  }
  return { scoped, submission }
}

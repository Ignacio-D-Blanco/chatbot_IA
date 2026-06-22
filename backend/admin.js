// Rutas del panel de administración
app.get('/admin/tenants', async (req, res) => {
  const { data } = await supabase.from('tenants').select('*')
  res.json(data)
})

app.post('/admin/tenants', async (req, res) => {
  const { name, slug, system_prompt, whatsapp_number } = req.body
  const { data, error } = await supabase
    .from('tenants')
    .insert({ name, slug, system_prompt, whatsapp_number })
    .select()
    .single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.put('/admin/tenants/:id', async (req, res) => {
  const { id } = req.params
  const updates = req.body
  const { data, error } = await supabase
    .from('tenants')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.get('/admin/tenants/:id/stats', async (req, res) => {
  const { id } = req.params
  
  const { count: totalUsers } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', id)

  const { count: totalConversations } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', id)

  res.json({ totalUsers, totalConversations })
})
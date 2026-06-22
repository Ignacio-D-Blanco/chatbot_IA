import supabase from './supabase.js'

export async function obtenerTenant(slug) {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single()

  if (error) throw new Error(`Tenant no encontrado: ${slug}`)
  return data
}

export async function obtenerDocumentosTenant(tenant_id, embedding, limite = 3) {
  const { data, error } = await supabase.rpc('match_documents_tenant', {
    query_embedding: embedding,
    tenant_id_param: tenant_id,
    match_count: limite
  })

  if (error) throw error
  return data ?? []
}
const chat = document.getElementById('chat-messages')
const input = document.getElementById('mensaje')
const boton = document.getElementById('enviar')

function agregarMensaje(texto, tipo) {
  const div = document.createElement('div')
  if (tipo === 'user') {
    div.classList.add('user-message')
  } else {
    div.classList.add('bot-message')
  }
  div.textContent = texto
  chat.appendChild(div)
  chat.scrollTop = chat.scrollHeight
}
async function enviarMensaje() {
  const mensaje = input.value.trim()
  if (!mensaje) return
  agregarMensaje(mensaje, 'user')
  input.value = ''
  agregarMensaje('Escribiendo...', 'bot')
  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mensaje
      })
    })
    const data = await response.json()
    chat.lastElementChild.remove()
    agregarMensaje(data.respuesta, 'bot')
  } catch (error) {
    console.error(error)
    chat.lastElementChild.remove()
    agregarMensaje(
      'Error al conectar con el servidor.',
      'bot'
    )
  }
}

boton.addEventListener('click', enviarMensaje)

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    enviarMensaje()
  }
})
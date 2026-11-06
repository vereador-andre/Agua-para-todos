// Exemplo estruturado dos manipuladores de Tela e Modal para app.js

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalContent = document.getElementById("modalContent");
const closeModalBtn = document.getElementById("closeModal");

// Abrir qualquer formulário ou detalhe em tela sobreposta dedicada
export function openScreen(title, htmlContent) {
  modalTitle.textContent = title;
  modalContent.innerHTML = htmlContent;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden"; // Trava a tela de fundo
}

export function closeScreen() {
  modal.classList.add("hidden");
  modalContent.innerHTML = "";
  document.body.style.overflow = ""; // Destrava a tela de fundo
}

// Fechamento no botão X
closeModalBtn.addEventListener("click", closeScreen);

// Fechar ao clicar fora no Desktop
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    closeScreen();
  }
});

// Suporte a Login por E-mail ou Telefone
const loginForm = document.getElementById("loginForm");
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  let identifier = document.getElementById("loginIdentifier").value.trim();
  const password = document.getElementById("loginPassword").value;
  const loginMsg = document.getElementById("loginMsg");
  
  loginMsg.textContent = "Autenticando...";

  // Se o usuário digitou apenas números (telefone), converte para formato de e-mail do Firebase Auth
  // Exemplo: 84988887777 vira 84988887777@aguaparatodos.local
  if (!identifier.includes("@")) {
    const cleanPhone = identifier.replace(/\D/g, "");
    identifier = `${cleanPhone}@aguaparatodos.local`;
  }

  try {
    // Chame sua função do Firebase:
    // await signInWithEmailAndPassword(auth, identifier, password);
    loginMsg.textContent = "";
  } catch (error) {
    loginMsg.textContent = "Dados incorretos ou usuário não encontrado.";
  }
});

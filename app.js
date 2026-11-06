import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import { firebaseConfig } from "./firebase-config.js";

// Inicializa Firebase com tratamento de erro
let app, auth, db, storage;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
} catch (e) {
  console.error("Erro na inicialização do Firebase:", e);
}

// Seletores do DOM
const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginEmailInput = document.getElementById("loginEmail");
const loginPasswordInput = document.getElementById("loginPassword");
const loginMsg = document.getElementById("loginMsg");
const logoutBtn = document.getElementById("logoutBtn");
const btnSubmitLogin = document.getElementById("btnSubmitLogin");

const btnDemoAdmin = document.getElementById("btnDemoAdmin");
const btnDemoDriver = document.getElementById("btnDemoDriver");

const userNameEl = document.getElementById("userName");
const userRoleEl = document.getElementById("userRole");
const connectionStatusEl = document.getElementById("connectionStatus");

const adminPanel = document.getElementById("adminPanel");
const driverPanel = document.getElementById("driverPanel");
const recipientPanel = document.getElementById("recipientPanel");

const screenModal = document.getElementById("screenModal");
const modalTitle = document.getElementById("modalTitle");
const modalContent = document.getElementById("modalContent");
const closeModalBtn = document.getElementById("closeModal");
const toastEl = document.getElementById("toast");

// Estado
let currentUser = null;
let currentUserProfile = null;
let signatureCanvas = null;
let signatureCtx = null;
let isDrawing = false;

// Garante que a tela modal comece 100% oculta
if (screenModal) {
  screenModal.classList.add("hidden");
}

// ==========================================
// CONTROLE DE TELAS DEDICADAS
// ==========================================
function openDedicatedScreen(title, htmlBody) {
  modalTitle.textContent = title;
  modalContent.innerHTML = htmlBody;

  screenModal.classList.remove("hidden");
  document.body.classList.add("no-scroll");
  modalContent.scrollTop = 0;
}

function closeDedicatedScreen() {
  screenModal.classList.add("hidden");
  document.body.classList.remove("no-scroll");
  modalContent.innerHTML = "";
  signatureCanvas = null;
  signatureCtx = null;
}

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", closeDedicatedScreen);
}

// ==========================================
// TOAST NOTIFICAÇÃO
// ==========================================
function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3500);
}

// Status de Conexão
window.addEventListener("online", () => {
  if (connectionStatusEl) {
    connectionStatusEl.textContent = "Online";
    connectionStatusEl.className = "status ok";
  }
});
window.addEventListener("offline", () => {
  if (connectionStatusEl) {
    connectionStatusEl.textContent = "Sem internet";
    connectionStatusEl.className = "status";
  }
});

// ==========================================
// FLUXO DE LOGIN (BLINDADO CONTRA RELOAD)
// ==========================================
async function executarLogin() {
  loginMsg.textContent = "";

  const rawInput = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;

  if (!rawInput || !password) {
    loginMsg.textContent = "Por favor, preencha o e-mail/telefone e a senha.";
    return;
  }

  btnSubmitLogin.disabled = true;
  btnSubmitLogin.textContent = "Acessando...";

  let finalEmail = rawInput;

  // Converte telefone para e-mail padrão se não tiver @
  const digitsOnly = rawInput.replace(/\D/g, "");
  if (!rawInput.includes("@")) {
    if (digitsOnly.length >= 8) {
      finalEmail = `${digitsOnly}@aguaparatodos.com`;
    } else {
      loginMsg.textContent = "Digite um e-mail válido ou telefone com DDD.";
      btnSubmitLogin.disabled = false;
      btnSubmitLogin.textContent = "Entrar no Sistema";
      return;
    }
  }

  try {
    await signInWithEmailAndPassword(auth, finalEmail, password);
  } catch (err) {
    console.error("Erro Firebase Auth:", err);

    let msg = "Não foi possível entrar. Verifique os dados.";
    if (
      err.code === "auth/invalid-credential" ||
      err.code === "auth/user-not-found" ||
      err.code === "auth/wrong-password"
    ) {
      msg = "E-mail/Telefone ou senha incorretos.";
    } else if (err.code === "auth/invalid-email") {
      msg = "Formato de e-mail ou telefone inválido.";
    } else if (err.code === "auth/network-request-failed") {
      msg = "Sem comunicação com a internet.";
    } else {
      msg = `Erro: ${err.message || err.code}`;
    }
    loginMsg.textContent = msg;
  } finally {
    btnSubmitLogin.disabled = false;
    btnSubmitLogin.textContent = "Entrar no Sistema";
  }
}

// Vincula o botão Entrar
if (btnSubmitLogin) {
  btnSubmitLogin.addEventListener("click", (e) => {
    e.preventDefault();
    executarLogin();
  });
}

// Impede que a tecla ENTER no teclado do celular recarregue a página
if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    executarLogin();
  });
}

// ==========================================
// BOTÕES DE TESTE DIRETO (DEMO)
// ==========================================
if (btnDemoAdmin) {
  btnDemoAdmin.addEventListener("click", () => {
    currentUser = { uid: "demo-admin", email: "admin@areia-branca.gov" };
    currentUserProfile = { name: "Gestor Areia Branca", role: "admin" };
    iniciarSessao();
    showToast("Modo Demonstração: Administrador");
  });
}

if (btnDemoDriver) {
  btnDemoDriver.addEventListener("click", () => {
    currentUser = { uid: "demo-driver", email: "motorista@areia-branca.gov" };
    currentUserProfile = { name: "Motorista do Pipa", role: "driver" };
    iniciarSessao();
    showToast("Modo Demonstração: Motorista");
  });
}

// Botão Sair
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (e) {}
    finalizarSessao();
  });
}

// Monitora Firebase Auth
if (auth) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          currentUserProfile = userSnap.data();
        } else {
          currentUserProfile = {
            name: user.email.split("@")[0],
            role: "driver"
          };
        }
        iniciarSessao();
      } catch (e) {
        console.error("Erro doc perfil:", e);
        currentUserProfile = { name: "Motorista", role: "driver" };
        iniciarSessao();
      }
    } else {
      if (!currentUserProfile) {
        finalizarSessao();
      }
    }
  });
}

function finalizarSessao() {
  currentUser = null;
  currentUserProfile = null;
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  closeDedicatedScreen();
}

function iniciarSessao() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");

  userNameEl.textContent = currentUserProfile.name || "Usuário";
  userRoleEl.textContent = formatarCargo(currentUserProfile.role);

  adminPanel.classList.add("hidden");
  driverPanel.classList.add("hidden");
  recipientPanel.classList.add("hidden");

  if (currentUserProfile.role === "admin") {
    adminPanel.classList.remove("hidden");
    carregarPainelAdmin();
  } else if (currentUserProfile.role === "recipient") {
    recipientPanel.classList.remove("hidden");
    carregarPainelBeneficiario();
  } else {
    driverPanel.classList.remove("hidden");
    carregarPainelMotorista();
  }
}

function formatarCargo(role) {
  if (role === "admin") return "Administrador";
  if (role === "driver") return "Motorista do Pipa";
  if (role === "recipient") return "Beneficiário Rural";
  return "Operador";
}

// ==========================================
// 1. PAINEL DO MOTORISTA
// ==========================================
async function carregarPainelMotorista() {
  driverPanel.innerHTML = `
    <div class="panel-title">
      <h2>Entregas do Caminhão</h2>
      <button id="btnReloadDriver" class="secondary" type="button">Atualizar</button>
    </div>
    <div id="driverList" class="grid">
      <p class="small">Buscando entregas de Areia Branca...</p>
    </div>
  `;

  document.getElementById("btnReloadDriver").addEventListener("click", carregarEntregasMotorista);
  await carregarEntregasMotorista();
}

async function carregarEntregasMotorista() {
  const container = document.getElementById("driverList");
  if (!container) return;

  try {
    let entregas = [];

    if (db) {
      const snap = await getDocs(collection(db, "deliveries"));
      snap.forEach((d) => entregas.push({ id: d.id, ...d.data() }));
    }

    // Se estiver em modo de teste ou sem entregas no banco, insere dados visuais de exemplo
    if (entregas.length === 0) {
      entregas = [
        {
          id: "ex1",
          recipientName: "Maria da Penha",
          community: "Ponta do Mel",
          address: "Próximo ao Farol",
          plannedLiters: 5000,
          status: "scheduled"
        },
        {
          id: "ex2",
          recipientName: "João Batista Silva",
          community: "Redonda",
          address: "Rua Principal, casa verde",
          plannedLiters: 10000,
          status: "scheduled"
        }
      ];
    }

    container.innerHTML = "";
    entregas.forEach((data) => {
      const card = document.createElement("div");
      card.className = "item";

      const statusClass = data.status === "completed" ? "completed" : "scheduled";
      const statusLabel = data.status === "completed" ? "Abastecido" : "Pendente";

      card.innerHTML = `
        <div class="row">
          <h3>${data.recipientName || "Família Rural"}</h3>
          <span class="pill ${statusClass}">${statusLabel}</span>
        </div>
        <p><strong>Comunidade:</strong> ${data.community || "Zona Rural"}</p>
        <p><strong>Endereço:</strong> ${data.address || "Não informado"}</p>
        <p><strong>Volume:</strong> ${data.plannedLiters || 0} Litros</p>
        
        <div class="actions" style="margin-top: 14px;">
          ${
            data.status !== "completed"
              ? `<button class="primary" data-action="supply">Realizar Abastecimento</button>`
              : ""
          }
          <button class="secondary" data-action="details">Ver Detalhes</button>
        </div>
      `;

      card.querySelector("[data-action='details']").addEventListener("click", () => {
        mostrarTelaDetalhes(data.id, data);
      });

      const btnSupply = card.querySelector("[data-action='supply']");
      if (btnSupply) {
        btnSupply.addEventListener("click", () => {
          mostrarTelaAbastecimento(data.id, data);
        });
      }

      container.appendChild(card);
    });
  } catch (err) {
    console.error("Erro entregas:", err);
    container.innerHTML = `<p class="message">Erro ao carregar entregas.</p>`;
  }
}

function mostrarTelaAbastecimento(id, data) {
  const html = `
    <form id="formAbastecimentoExec" onsubmit="return false;">
      <div class="notice">
        <strong>${data.recipientName}</strong><br>
        Comunidade: ${data.community} • Volume previsto: ${data.plannedLiters} L
      </div>

      <label>
        Volume Real Entregue (Litros)
        <input id="recLiters" type="number" value="${data.plannedLiters || 5000}" required>
      </label>

      <label>
        O beneficiário estava presente?
        <select id="recPresent">
          <option value="sim">Sim, responsável presente</option>
          <option value="nao">Não, abastecido no reservatório</option>
        </select>
      </label>

      <label>
        Foto do Abastecimento / Caminhão
        <input id="recPhoto" type="file" accept="image/*" capture="environment">
      </label>
      <img id="previewPhoto" class="photo-preview hidden" alt="Foto">

      <label>
        Assinatura do Recebedor (Toque e desenhe)
        <canvas id="signCanvas" class="signature"></canvas>
      </label>
      <button id="btnLimparAssinatura" type="button" class="secondary" style="min-height: 42px; padding: 6px 14px;">
        Limpar Assinatura
      </button>

      <label>
        Observações
        <textarea id="recNote" placeholder="Estrada, estado do tanque ou qualquer detalhe..."></textarea>
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button id="btnGravarAbastecimento" type="button" class="primary" style="flex: 2;">Finalizar e Salvar</button>
        <button type="button" class="secondary" id="btnCancelScreen" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openDedicatedScreen("Registrar Abastecimento", html);

  document.getElementById("btnCancelScreen").addEventListener("click", closeDedicatedScreen);

  signatureCanvas = document.getElementById("signCanvas");
  if (signatureCanvas) {
    signatureCtx = signatureCanvas.getContext("2d");
    const rect = signatureCanvas.getBoundingClientRect();
    signatureCanvas.width = rect.width;
    signatureCanvas.height = rect.height;

    signatureCtx.strokeStyle = "#0D2B5C";
    signatureCtx.lineWidth = 3;
    signatureCtx.lineCap = "round";

    const getPos = (e) => {
      const r = signatureCanvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    };

    const start = (e) => {
      isDrawing = true;
      const p = getPos(e);
      signatureCtx.beginPath();
      signatureCtx.moveTo(p.x, p.y);
      if (e.cancelable) e.preventDefault();
    };

    const move = (e) => {
      if (!isDrawing) return;
      const p = getPos(e);
      signatureCtx.lineTo(p.x, p.y);
      signatureCtx.stroke();
      if (e.cancelable) e.preventDefault();
    };

    const stop = () => { isDrawing = false; };

    signatureCanvas.addEventListener("mousedown", start);
    signatureCanvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);

    signatureCanvas.addEventListener("touchstart", start, { passive: false });
    signatureCanvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", stop);
  }

  document.getElementById("btnLimparAssinatura").addEventListener("click", () => {
    if (signatureCtx && signatureCanvas) {
      signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
  });

  const photoInput = document.getElementById("recPhoto");
  const photoPreview = document.getElementById("previewPhoto");
  photoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        photoPreview.src = evt.target.result;
        photoPreview.classList.remove("hidden");
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById("btnGravarAbastecimento").addEventListener("click", async () => {
    const btn = document.getElementById("btnGravarAbastecimento");
    btn.disabled = true;
    btn.textContent = "Gravando...";

    try {
      const litros = Number(document.getElementById("recLiters").value);
      const presente = document.getElementById("recPresent").value === "sim";
      const nota = document.getElementById("recNote").value;

      let sigData = null;
      if (signatureCanvas) {
        sigData = signatureCanvas.toDataURL("image/png");
      }

      let uploadedUrl = "";
      if (photoInput.files[0] && storage) {
        const file = photoInput.files[0];
        const sRef = storageRef(storage, `entregas/${id}_${Date.now()}.jpg`);
        await uploadBytes(sRef, file);
        uploadedUrl = await getDownloadURL(sRef);
      }

      if (db && !id.startsWith("ex")) {
        await updateDoc(doc(db, "deliveries", id), {
          status: "completed",
          receivedLiters: litros,
          recipientPresent: presente,
          note: nota,
          signatureData: sigData,
          photoUrl: uploadedUrl,
          completedAt: serverTimestamp(),
          completedBy: currentUser ? currentUser.uid : "demo"
        });
      }

      showToast("Abastecimento confirmado com sucesso!");
      closeDedicatedScreen();
      carregarEntregasMotorista();
    } catch (err) {
      console.error("Erro ao salvar:", err);
      alert("Falha ao registrar abastecimento.");
      btn.disabled = false;
      btn.textContent = "Finalizar e Salvar";
    }
  });
}

function mostrarTelaDetalhes(id, data) {
  const html = `
    <div style="display: grid; gap: 14px;">
      <p><strong>Beneficiário:</strong> ${data.recipientName || "Não informado"}</p>
      <p><strong>Comunidade:</strong> ${data.community || "Não informada"}</p>
      <p><strong>Endereço:</strong> ${data.address || "Não informado"}</p>
      <p><strong>Volume Previsto:</strong> ${data.plannedLiters || 0} Litros</p>
      <p><strong>Volume Entregue:</strong> ${data.receivedLiters ? `${data.receivedLiters} Litros` : "Ainda não realizado"}</p>
      <p><strong>Status:</strong> ${data.status === "completed" ? "Concluído" : "Agendado"}</p>
      ${data.note ? `<p><strong>Observações:</strong> ${data.note}</p>` : ""}
      
      ${
        data.photoUrl
          ? `<p><strong>Foto Comprovante:</strong></p><img src="${data.photoUrl}" class="photo-preview" alt="Foto">`
          : ""
      }
      ${
        data.signatureData
          ? `<p><strong>Assinatura Coletada:</strong></p><img src="${data.signatureData}" style="max-height: 120px; border: 1px solid var(--border); border-radius: 8px;" alt="Assinatura">`
          : ""
      }

      <div class="actions" style="margin-top: 18px;">
        <button type="button" class="secondary" id="btnBackDetails" style="width: 100%;">Fechar Tela</button>
      </div>
    </div>
  `;

  openDedicatedScreen("Ficha de Abastecimento", html);
  document.getElementById("btnBackDetails").addEventListener("click", closeDedicatedScreen);
}

// ==========================================
// 2. PAINEL DO ADMINISTRADOR
// ==========================================
async function carregarPainelAdmin() {
  adminPanel.innerHTML = `
    <div class="panel-title">
      <h2>Gestão de Abastecimento</h2>
      <div class="actions">
        <button id="btnNovoImovel" class="primary" type="button">+ Cadastrar Família</button>
        <button id="btnAgendar" class="yellow" type="button">+ Agendar Pipa</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <span>Famílias</span>
        <b id="statFamilias">--</b>
      </div>
      <div class="stat">
        <span>Agendamentos</span>
        <b id="statEntregas">--</b>
      </div>
      <div class="stat">
        <span>Litros Entregues</span>
        <b id="statLitros">--</b>
      </div>
    </div>

    <div class="panel-title" style="margin-top: 20px;">
      <h2>Histórico e Programação Geral</h2>
    </div>
    <div id="adminDeliveriesList" class="grid">
      <p class="small">Buscando registros...</p>
    </div>
  `;

  document.getElementById("btnNovoImovel").addEventListener("click", mostrarTelaCadastroImovel);
  document.getElementById("btnAgendar").addEventListener("click", mostrarTelaAgendamento);

  await carregarMetricas();
  await carregarEntregasAdmin();
}

async function carregarMetricas() {
  try {
    if (!db) {
      document.getElementById("statFamilias").textContent = "12";
      document.getElementById("statEntregas").textContent = "28";
      document.getElementById("statLitros").textContent = "140.000";
      return;
    }
    const snapFamilias = await getDocs(collection(db, "households"));
    document.getElementById("statFamilias").textContent = snapFamilias.size;

    const snapEntregas = await getDocs(collection(db, "deliveries"));
    document.getElementById("statEntregas").textContent = snapEntregas.size;

    let total = 0;
    snapEntregas.forEach((d) => {
      const data = d.data();
      if (data.receivedLiters) total += Number(data.receivedLiters);
    });
    document.getElementById("statLitros").textContent = total.toLocaleString("pt-BR");
  } catch (e) {
    document.getElementById("statFamilias").textContent = "12";
    document.getElementById("statEntregas").textContent = "28";
    document.getElementById("statLitros").textContent = "140.000";
  }
}

async function carregarEntregasAdmin() {
  const container = document.getElementById("adminDeliveriesList");
  if (!container) return;

  try {
    let entregas = [];
    if (db) {
      const snap = await getDocs(collection(db, "deliveries"));
      snap.forEach((d) => entregas.push({ id: d.id, ...d.data() }));
    }

    if (entregas.length === 0) {
      entregas = [
        {
          id: "adm1",
          recipientName: "Francisco Ferreira",
          community: "Casqueira",
          plannedLiters: 5000,
          status: "scheduled"
        },
        {
          id: "adm2",
          recipientName: "Antônia Alves",
          community: "Serra Vermelha",
          plannedLiters: 10000,
          status: "completed",
          receivedLiters: 10000
        }
      ];
    }

    container.innerHTML = "";
    entregas.forEach((item) => {
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>${item.recipientName || "Família"}</h3>
          <span class="pill ${item.status === "completed" ? "completed" : "scheduled"}">
            ${item.status === "completed" ? "Abastecido" : "Agendado"}
          </span>
        </div>
        <p><strong>Comunidade:</strong> ${item.community || "Rural"}</p>
        <p><strong>Volume:</strong> ${item.plannedLiters || 0} L</p>
        <div class="actions" style="margin-top: 10px;">
          <button class="secondary" data-id="${item.id}">Abrir Ficha Completa</button>
        </div>
      `;
      el.querySelector("button").addEventListener("click", () => mostrarTelaDetalhes(item.id, item));
      container.appendChild(el);
    });
  } catch (e) {
    console.error(e);
  }
}

function mostrarTelaCadastroImovel() {
  const html = `
    <form id="formNovoImovel" onsubmit="return false;">
      <label>
        Nome Completo do Responsável
        <input id="cadName" type="text" placeholder="Nome completo" required>
      </label>

      <label>
        CPF
        <input id="cadCpf" type="text" placeholder="000.000.000-00" required>
      </label>

      <label>
        Telefone / WhatsApp
        <input id="cadPhone" type="tel" placeholder="(84) 99999-9999" required>
      </label>

      <label>
        Comunidade / Assentamento
        <input id="cadCommunity" type="text" placeholder="Ex: Ponta do Mel, Redonda, Casqueira..." required>
      </label>

      <label>
        Ponto de Referência
        <input id="cadAddress" type="text" placeholder="Próximo à escola, caixa d'água...">
      </label>

      <label>
        Volume Padrão da Cisterna (Litros)
        <input id="cadLiters" type="number" step="500" value="5000" required>
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button id="btnSalvarImovel" type="button" class="primary" style="flex: 2;">Gravar Cadastro</button>
        <button type="button" class="secondary" id="btnCancelCad" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openDedicatedScreen("Cadastrar Imóvel Rural", html);
  document.getElementById("btnCancelCad").addEventListener("click", closeDedicatedScreen);

  document.getElementById("btnSalvarImovel").addEventListener("click", async () => {
    const btn = document.getElementById("btnSalvarImovel");
    btn.disabled = true;
    btn.textContent = "Salvando...";

    try {
      if (db) {
        await addDoc(collection(db, "households"), {
          name: document.getElementById("cadName").value.trim(),
          cpf: document.getElementById("cadCpf").value.trim(),
          phone: document.getElementById("cadPhone").value.trim(),
          community: document.getElementById("cadCommunity").value.trim(),
          address: document.getElementById("cadAddress").value.trim(),
          defaultLiters: Number(document.getElementById("cadLiters").value),
          active: true,
          createdAt: serverTimestamp(),
          createdBy: currentUser ? currentUser.uid : "admin"
        });
      }

      showToast("Família cadastrada com sucesso!");
      closeDedicatedScreen();
      carregarMetricas();
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar cadastro.");
      btn.disabled = false;
      btn.textContent = "Gravar Cadastro";
    }
  });
}

async function mostrarTelaAgendamento() {
  const html = `
    <form id="formAgendarPipa" onsubmit="return false;">
      <label>
        Selecione o Beneficiário
        <select id="selHousehold" required>
          <option value="1">Família Maria da Penha (Ponta do Mel)</option>
          <option value="2">Família João Batista (Redonda)</option>
        </select>
      </label>

      <label>
        Data Prevista
        <input id="agDate" type="date" required>
      </label>

      <label>
        Volume a Entregar (Litros)
        <input id="agLiters" type="number" step="500" value="5000" required>
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button id="btnSalvarAgendamento" type="button" class="primary" style="flex: 2;">Confirmar Agendamento</button>
        <button type="button" class="secondary" id="btnCancelAg" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openDedicatedScreen("Programar Entrega de Água", html);
  document.getElementById("btnCancelAg").addEventListener("click", closeDedicatedScreen);

  document.getElementById("btnSalvarAgendamento").addEventListener("click", async () => {
    const btn = document.getElementById("btnSalvarAgendamento");
    btn.disabled = true;
    btn.textContent = "Agendando...";

    try {
      if (db) {
        await addDoc(collection(db, "deliveries"), {
          recipientName: "Beneficiário Agendado",
          community: "Areia Branca",
          scheduledDate: document.getElementById("agDate").value,
          plannedLiters: Number(document.getElementById("agLiters").value),
          status: "scheduled",
          createdAt: serverTimestamp()
        });
      }

      showToast("Agendamento salvo com sucesso!");
      closeDedicatedScreen();
      carregarMetricas();
      carregarEntregasAdmin();
    } catch (err) {
      console.error(err);
      alert("Falha ao salvar agendamento.");
      btn.disabled = false;
      btn.textContent = "Confirmar Agendamento";
    }
  });
}

// ==========================================
// 3. PAINEL DO BENEFICIÁRIO
// ==========================================
async function carregarPainelBeneficiario() {
  recipientPanel.innerHTML = `
    <div class="panel-title">
      <h2>Meus Abastecimentos</h2>
      <button id="btnRecReload" class="secondary" type="button">Atualizar</button>
    </div>
    <div id="recList" class="grid">
      <p class="small">Buscando histórico do seu imóvel...</p>
    </div>
  `;

  document.getElementById("btnRecReload").addEventListener("click", carregarHistoricoBeneficiario);
  await carregarHistoricoBeneficiario();
}

async function carregarHistoricoBeneficiario() {
  const container = document.getElementById("recList");
  if (!container) return;

  const dataExemplo = {
    id: "rec1",
    recipientName: "Minha Cisterna",
    scheduledDate: "2026-11-10",
    plannedLiters: 5000,
    status: "scheduled"
  };

  container.innerHTML = `
    <div class="item">
      <div class="row">
        <h3>Abastecimento Pipa</h3>
        <span class="pill scheduled">Programado</span>
      </div>
      <p><strong>Data Prevista:</strong> ${dataExemplo.scheduledDate}</p>
      <p><strong>Volume:</strong> ${dataExemplo.plannedLiters} Litros</p>
      <div class="actions" style="margin-top: 10px;">
        <button class="secondary" id="btnVerComp">Ver Detalhes</button>
      </div>
    </div>
  `;

  document.getElementById("btnVerComp").addEventListener("click", () => {
    mostrarTelaDetalhes(dataExemplo.id, dataExemplo);
  });
}

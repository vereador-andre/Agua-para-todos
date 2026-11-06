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
  setDoc,
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

// Credenciais diretas
const firebaseConfig = {
  apiKey: "AIzaSyAAf5Tfvh0Ow-iusTMuvax5VlxBgjtVFeo",
  authDomain: "agua-para-todos-18167.firebaseapp.com",
  projectId: "agua-para-todos-18167",
  storageBucket: "agua-para-todos-18167.firebasestorage.app",
  messagingSenderId: "154424742994",
  appId: "1:154424742994:web:46f14ccf8fc781e8867b8b"
};

// Inicialização
let app = null;
let auth = null;
let db = null;
let storage = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
} catch (e) {
  console.error("Falha ao inicializar Firebase:", e);
}

// Elementos DOM
const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginEmailInput = document.getElementById("loginEmail");
const loginPasswordInput = document.getElementById("loginPassword");
const loginMsg = document.getElementById("loginMsg");
const logoutBtn = document.getElementById("logoutBtn");
const btnSubmitLogin = document.getElementById("btnSubmitLogin");

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

if (screenModal) {
  screenModal.classList.add("hidden");
}

function exibirErroLogin(texto) {
  if (!loginMsg) return;
  loginMsg.textContent = texto;
  loginMsg.classList.add("visible");
}

function limparErroLogin() {
  if (!loginMsg) return;
  loginMsg.textContent = "";
  loginMsg.classList.remove("visible");
}

// Controle de Telas Flutuantes
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

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3500);
}

// Execução de Login
async function executarLogin() {
  limparErroLogin();

  const rawInput = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;

  if (!rawInput || !password) {
    exibirErroLogin("Por favor, preencha o e-mail/telefone e a senha.");
    return;
  }

  if (!auth) {
    exibirErroLogin("Firebase Auth não carregado.");
    return;
  }

  btnSubmitLogin.disabled = true;
  btnSubmitLogin.textContent = "Conectando ao Firebase...";

  let finalEmail = rawInput;

  const digitsOnly = rawInput.replace(/\D/g, "");
  if (!rawInput.includes("@")) {
    if (digitsOnly.length >= 8) {
      finalEmail = `${digitsOnly}@aguaparatodos.com`;
    } else {
      exibirErroLogin("Digite um e-mail válido ou telefone com DDD.");
      btnSubmitLogin.disabled = false;
      btnSubmitLogin.textContent = "Entrar no Sistema";
      return;
    }
  }

  try {
    await signInWithEmailAndPassword(auth, finalEmail, password);
  } catch (err) {
    console.error("Erro no login:", err);

    let mensagem = "Não foi possível entrar.";

    if (
      err.code === "auth/invalid-credential" ||
      err.code === "auth/user-not-found" ||
      err.code === "auth/wrong-password"
    ) {
      mensagem = "E-mail/Telefone ou senha incorretos.";
    } else if (err.code === "auth/invalid-email") {
      mensagem = "Formato de e-mail inválido.";
    } else if (err.code === "auth/unauthorized-domain") {
      mensagem = "Domínio GitHub Pages não autorizado no Firebase.";
    } else if (err.code === "auth/network-request-failed") {
      mensagem = "Sem comunicação com a internet.";
    } else {
      mensagem = `Falha: ${err.message || err.code}`;
    }

    exibirErroLogin(mensagem);
  } finally {
    btnSubmitLogin.disabled = false;
    btnSubmitLogin.textContent = "Entrar no Sistema";
  }
}

if (btnSubmitLogin) {
  btnSubmitLogin.addEventListener("click", (e) => {
    e.preventDefault();
    executarLogin();
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    executarLogin();
  });
}

// Sair
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      if (auth) await signOut(auth);
    } catch (e) {}
    finalizarSessao();
  });
}

// Monitor de Sessão
if (auth) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          currentUserProfile = userSnap.data();
        } else {
          // Extrai o nome de exibição amigável a partir do e-mail
          let fallbackName = user.email.split("@")[0].replace(/[._]/g, " ");
          fallbackName = fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1);

          currentUserProfile = {
            name: fallbackName,
            email: user.email,
            role: "admin"
          };
        }
        iniciarSessao();
      } catch (e) {
        console.error("Erro leitura users:", e);
        currentUserProfile = { name: "André Kelly", role: "admin" };
        iniciarSessao();
      }
    } else {
      finalizarSessao();
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

  // Nome do usuário logado exibido logo abaixo do cargo
  userNameEl.textContent = currentUserProfile.name || currentUser.email;
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
// PAINEL DO ADMINISTRADOR (4 CADASTROS)
// ==========================================
async function carregarPainelAdmin() {
  adminPanel.innerHTML = `
    <div class="panel-title">
      <h2>Gestão de Abastecimento</h2>
    </div>

    <!-- 4 Botões Principais de Gestão -->
    <div class="actions" style="margin-bottom: 22px;">
      <button id="btnCadFamilia" class="primary" type="button">
        + Cadastrar Família
      </button>
      <button id="btnCadMotorista" class="secondary" type="button">
        + Cadastrar Motorista
      </button>
      <button id="btnCadVeiculo" class="secondary" type="button">
        + Cadastrar Veículo
      </button>
      <button id="btnCadEntrega" class="yellow" type="button">
        + Cadastrar Entrega
      </button>
    </div>

    <div class="stats">
      <div class="stat">
        <span>Famílias</span>
        <b id="statFamilias">--</b>
      </div>
      <div class="stat">
        <span>Caminhões</span>
        <b id="statVeiculos">--</b>
      </div>
      <div class="stat">
        <span>Entregas Mês</span>
        <b id="statEntregas">--</b>
      </div>
      <div class="stat">
        <span>Litros Entregues</span>
        <b id="statLitros">--</b>
      </div>
    </div>

    <div class="panel-title" style="margin-top: 24px;">
      <h2>Histórico e Programação Geral</h2>
    </div>
    <div id="adminDeliveriesList" class="grid">
      <p class="small">Buscando registros...</p>
    </div>
  `;

  document.getElementById("btnCadFamilia").addEventListener("click", mostrarTelaCadFamilia);
  document.getElementById("btnCadMotorista").addEventListener("click", mostrarTelaCadMotorista);
  document.getElementById("btnCadVeiculo").addEventListener("click", mostrarTelaCadVeiculo);
  document.getElementById("btnCadEntrega").addEventListener("click", mostrarTelaCadEntrega);

  await carregarMetricas();
  await carregarEntregasAdmin();
}

async function carregarMetricas() {
  try {
    if (!db) return;
    const snapFamilias = await getDocs(collection(db, "households"));
    document.getElementById("statFamilias").textContent = snapFamilias.size;

    const snapVeiculos = await getDocs(collection(db, "vehicles"));
    document.getElementById("statVeiculos").textContent = snapVeiculos.size;

    const snapEntregas = await getDocs(collection(db, "deliveries"));
    document.getElementById("statEntregas").textContent = snapEntregas.size;

    let total = 0;
    snapEntregas.forEach((d) => {
      const data = d.data();
      if (data.receivedLiters) total += Number(data.receivedLiters);
    });
    document.getElementById("statLitros").textContent = total.toLocaleString("pt-BR");
  } catch (e) {
    console.error("Erro metricas:", e);
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
      container.innerHTML = `<div class="item"><p>Nenhum abastecimento cadastrado ainda.</p></div>`;
      return;
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
        <p><strong>Caminhão / Pipa:</strong> ${item.truckModel || item.driverName || "Em escala"}</p>
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

// ------------------------------------------
// 1. TELA: CADASTRAR FAMÍLIA
// ------------------------------------------
function mostrarTelaCadFamilia() {
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
        Telefone / WhatsApp (Será usado no login do beneficiário)
        <input id="cadPhone" type="tel" placeholder="(84) 99999-9999" required>
      </label>

      <label>
        Comunidade / Assentamento
        <input id="cadCommunity" type="text" placeholder="Ex: Ponta do Mel, Redonda, Casqueira..." required>
      </label>

      <label>
        Ponto de Referência / Endereço
        <input id="cadAddress" type="text" placeholder="Próximo à escola, caixa d'água azul...">
      </label>

      <label>
        Volume Padrão da Cisterna / Tanque (Litros)
        <input id="cadLiters" type="number" step="500" value="5000" required>
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button id="btnSalvarImovel" type="button" class="primary" style="flex: 2;">Gravar Família</button>
        <button type="button" class="secondary" id="btnCancelCad" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openDedicatedScreen("Cadastrar Família Beneficiária", html);
  document.getElementById("btnCancelCad").addEventListener("click", closeDedicatedScreen);

  document.getElementById("btnSalvarImovel").addEventListener("click", async () => {
    const btn = document.getElementById("btnSalvarImovel");
    btn.disabled = true;
    btn.textContent = "Salvando...";

    try {
      const phoneDigits = document.getElementById("cadPhone").value.replace(/\D/g, "");
      const generatedEmail = `${phoneDigits}@aguaparatodos.com`;

      const docRef = await addDoc(collection(db, "households"), {
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

      // Cria ou atualiza o perfil em 'users' para permitir login do beneficiário
      await addDoc(collection(db, "users"), {
        name: document.getElementById("cadName").value.trim(),
        phone: document.getElementById("cadPhone").value.trim(),
        email: generatedEmail,
        role: "recipient",
        householdId: docRef.id,
        createdAt: serverTimestamp()
      });

      showToast("Família cadastrada com sucesso!");
      closeDedicatedScreen();
      carregarMetricas();
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar cadastro de família.");
      btn.disabled = false;
      btn.textContent = "Gravar Família";
    }
  });
}

// ------------------------------------------
// 2. TELA: CADASTRAR MOTORISTA
// ------------------------------------------
function mostrarTelaCadMotorista() {
  const html = `
    <form id="formCadMotorista" onsubmit="return false;">
      <label>
        Nome Completo do Motorista
        <input id="motName" type="text" placeholder="Nome do motorista" required>
      </label>

      <label>
        Telefone / Celular (Será o login de acesso)
        <input id="motPhone" type="tel" placeholder="(84) 99999-9999" required>
      </label>

      <label>
        E-mail (Opcional)
        <input id="motEmail" type="email" placeholder="motorista@exemplo.com">
      </label>

      <label>
        Número da CNH / Categoria
        <input id="motCnh" type="text" placeholder="Ex: 01234567890 - Categoria D">
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button id="btnSalvarMotorista" type="button" class="primary" style="flex: 2;">Gravar Motorista</button>
        <button type="button" class="secondary" id="btnCancelMot" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openDedicatedScreen("Cadastrar Motorista do Pipa", html);
  document.getElementById("btnCancelMot").addEventListener("click", closeDedicatedScreen);

  document.getElementById("btnSalvarMotorista").addEventListener("click", async () => {
    const btn = document.getElementById("btnSalvarMotorista");
    btn.disabled = true;
    btn.textContent = "Gravando...";

    try {
      const phoneDigits = document.getElementById("motPhone").value.replace(/\D/g, "");
      const finalEmail = document.getElementById("motEmail").value.trim() || `${phoneDigits}@aguaparatodos.com`;

      await addDoc(collection(db, "users"), {
        name: document.getElementById("motName").value.trim(),
        phone: document.getElementById("motPhone").value.trim(),
        email: finalEmail,
        cnh: document.getElementById("motCnh").value.trim(),
        role: "driver",
        active: true,
        createdAt: serverTimestamp(),
        createdBy: currentUser ? currentUser.uid : "admin"
      });

      showToast("Motorista cadastrado com sucesso!");
      closeDedicatedScreen();
      carregarMetricas();
    } catch (err) {
      console.error(err);
      alert("Erro ao cadastrar motorista.");
      btn.disabled = false;
      btn.textContent = "Gravar Motorista";
    }
  });
}

// ------------------------------------------
// 3. TELA: CADASTRAR VEÍCULO (CAMINHÃO-PIPA)
// ------------------------------------------
async function mostrarTelaCadVeiculo() {
  const html = `
    <form id="formCadVeiculo" onsubmit="return false;">
      <label>
        Placa do Caminhão
        <input id="veicPlaca" type="text" placeholder="Ex: ABC-1234 ou ABC1D23" required>
      </label>

      <label>
        Modelo do Veículo
        <input id="veicModelo" type="text" placeholder="Ex: Mercedes-Benz 1620, Ford Cargo..." required>
      </label>

      <label>
        Capacidade Total do Tanque (Litros)
        <input id="veicCapacidade" type="number" step="500" value="10000" required>
      </label>

      <label>
        Motorista Responsável Habitual
        <select id="veicMotorista">
          <option value="">Carregando motoristas cadastrados...</option>
        </select>
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button id="btnSalvarVeiculo" type="button" class="primary" style="flex: 2;">Gravar Veículo</button>
        <button type="button" class="secondary" id="btnCancelVeic" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openDedicatedScreen("Cadastrar Caminhão-Pipa", html);
  document.getElementById("btnCancelVeic").addEventListener("click", closeDedicatedScreen);

  const selectMotorista = document.getElementById("veicMotorista");
  try {
    const snap = await getDocs(collection(db, "users"));
    selectMotorista.innerHTML = '<option value="">Selecione o motorista titular...</option>';
    snap.forEach((docSnap) => {
      const u = docSnap.data();
      if (u.role === "driver") {
        const opt = document.createElement("option");
        opt.value = docSnap.id;
        opt.textContent = `${u.name} (${u.phone || "Sem tel"})`;
        selectMotorista.appendChild(opt);
      }
    });
  } catch (e) {
    selectMotorista.innerHTML = '<option value="">Sem motoristas cadastrados</option>';
  }

  document.getElementById("btnSalvarVeiculo").addEventListener("click", async () => {
    const btn = document.getElementById("btnSalvarVeiculo");
    btn.disabled = true;
    btn.textContent = "Salvando...";

    try {
      await addDoc(collection(db, "vehicles"), {
        plate: document.getElementById("veicPlaca").value.trim().toUpperCase(),
        model: document.getElementById("veicModelo").value.trim(),
        capacityLiters: Number(document.getElementById("veicCapacidade").value),
        driverId: selectMotorista.value,
        active: true,
        createdAt: serverTimestamp()
      });

      showToast("Caminhão cadastrado com sucesso!");
      closeDedicatedScreen();
      carregarMetricas();
    } catch (err) {
      console.error(err);
      alert("Erro ao cadastrar veículo.");
      btn.disabled = false;
      btn.textContent = "Gravar Veículo";
    }
  });
}

// ------------------------------------------
// 4. TELA: CADASTRAR ENTREGA (AGENDAMENTO)
// ------------------------------------------
async function mostrarTelaCadEntrega() {
  const html = `
    <form id="formAgendarPipa" onsubmit="return false;">
      <label>
        Família / Imóvel de Destino
        <select id="selHousehold" required>
          <option value="">Carregando famílias cadastradas...</option>
        </select>
      </label>

      <label>
        Caminhão / Veículo Escalado
        <select id="selVeiculo" required>
          <option value="">Carregando caminhões...</option>
        </select>
      </label>

      <label>
        Data Prevista da Entrega
        <input id="agDate" type="date" required>
      </label>

      <label>
        Volume a Entregar (Litros)
        <input id="agLiters" type="number" step="500" value="5000" required>
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button id="btnSalvarAgendamento" type="button" class="yellow" style="flex: 2;">Confirmar Entrega</button>
        <button type="button" class="secondary" id="btnCancelAg" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openDedicatedScreen("Cadastrar Entrega de Água", html);
  document.getElementById("btnCancelAg").addEventListener("click", closeDedicatedScreen);

  const selectFamilias = document.getElementById("selHousehold");
  const selectVeiculos = document.getElementById("selVeiculo");

  let households = [];
  let vehicles = [];

  // Puxa famílias
  try {
    const snapH = await getDocs(collection(db, "households"));
    selectFamilias.innerHTML = '<option value="">Selecione a família...</option>';
    snapH.forEach((docSnap) => {
      const h = docSnap.data();
      households.push({ id: docSnap.id, ...h });
      const opt = document.createElement("option");
      opt.value = docSnap.id;
      opt.textContent = `${h.name} (${h.community || "Zona Rural"})`;
      selectFamilias.appendChild(opt);
    });
  } catch (e) {
    selectFamilias.innerHTML = '<option value="">Nenhuma família encontrada</option>';
  }

  // Puxa caminhões
  try {
    const snapV = await getDocs(collection(db, "vehicles"));
    selectVeiculos.innerHTML = '<option value="">Selecione o caminhão...</option>';
    snapV.forEach((docSnap) => {
      const v = docSnap.data();
      vehicles.push({ id: docSnap.id, ...v });
      const opt = document.createElement("option");
      opt.value = docSnap.id;
      opt.textContent = `${v.model} (${v.plate}) - ${v.capacityLiters}L`;
      selectVeiculos.appendChild(opt);
    });
  } catch (e) {
    selectVeiculos.innerHTML = '<option value="">Nenhum caminhão encontrado</option>';
  }

  selectFamilias.addEventListener("change", () => {
    const found = households.find((item) => item.id === selectFamilias.value);
    if (found && found.defaultLiters) {
      document.getElementById("agLiters").value = found.defaultLiters;
    }
  });

  document.getElementById("btnSalvarAgendamento").addEventListener("click", async () => {
    const btn = document.getElementById("btnSalvarAgendamento");
    btn.disabled = true;
    btn.textContent = "Agendando...";

    const hId = selectFamilias.value;
    const vId = selectVeiculos.value;

    const hData = households.find((item) => item.id === hId);
    const vData = vehicles.find((item) => item.id === vId);

    try {
      await addDoc(collection(db, "deliveries"), {
        householdId: hId,
        recipientName: hData ? hData.name : "Beneficiário",
        recipientPhone: hData ? hData.phone : "",
        address: hData ? hData.address : "",
        community: hData ? hData.community : "",
        vehicleId: vId,
        truckModel: vData ? `${vData.model} (${vData.plate})` : "Caminhão Pipa",
        driverUid: vData ? vData.driverId : "",
        scheduledDate: document.getElementById("agDate").value,
        plannedLiters: Number(document.getElementById("agLiters").value),
        status: "scheduled",
        createdAt: serverTimestamp(),
        createdBy: currentUser ? currentUser.uid : "admin"
      });

      showToast("Entrega agendada com sucesso!");
      closeDedicatedScreen();
      carregarMetricas();
      carregarEntregasAdmin();
    } catch (err) {
      console.error(err);
      alert("Falha ao salvar entrega.");
      btn.disabled = false;
      btn.textContent = "Confirmar Entrega";
    }
  });
}

// ------------------------------------------
// DETALHES DE UMA ENTREGA
// ------------------------------------------
function mostrarTelaDetalhes(id, data) {
  const html = `
    <div style="display: grid; gap: 14px;">
      <p><strong>Beneficiário:</strong> ${data.recipientName || "Não informado"}</p>
      <p><strong>Comunidade:</strong> ${data.community || "Não informada"}</p>
      <p><strong>Endereço / Referência:</strong> ${data.address || "Não informado"}</p>
      <p><strong>Caminhão / Placa:</strong> ${data.truckModel || "Não especificado"}</p>
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
// PAINEL DO MOTORISTA (ENTREGAS DO DIA)
// ==========================================
async function carregarPainelMotorista() {
  driverPanel.innerHTML = `
    <div class="panel-title">
      <h2>Minhas Entregas Escaladas</h2>
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
      snap.forEach((d) => {
        const item = d.data();
        // Exibe se estiver atribuído a este motorista ou sem motorista fixo
        if (!item.driverUid || item.driverUid === currentUser.uid) {
          entregas.push({ id: d.id, ...item });
        }
      });
    }

    if (entregas.length === 0) {
      container.innerHTML = `
        <div class="item">
          <p>Nenhuma entrega agendada para o seu caminhão no momento.</p>
        </div>
      `;
      return;
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
              ? `<button class="primary" data-action="supply">Confirmar Abastecimento</button>`
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
    container.innerHTML = `<p class="message visible">Erro ao carregar entregas.</p>`;
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
        Foto da Entrega (Caminhão / Cisterna)
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
        <textarea id="recNote" placeholder="Estrada, tanque limpo ou qualquer detalhe..."></textarea>
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

      if (db) {
        await updateDoc(doc(db, "deliveries", id), {
          status: "completed",
          receivedLiters: litros,
          recipientPresent: presente,
          note: nota,
          signatureData: sigData,
          photoUrl: uploadedUrl,
          completedAt: serverTimestamp(),
          completedBy: currentUser ? currentUser.uid : "driver"
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

// ==========================================
// PAINEL DO BENEFICIÁRIO
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

  try {
    let list = [];
    if (db) {
      const snap = await getDocs(collection(db, "deliveries"));
      snap.forEach((d) => {
        const it = d.data();
        if (currentUserProfile && it.recipientPhone === currentUserProfile.phone) {
          list.push({ id: d.id, ...it });
        }
      });
    }

    if (list.length === 0) {
      container.innerHTML = `<div class="item"><p>Nenhum abastecimento encontrado para o seu contato.</p></div>`;
      return;
    }

    container.innerHTML = "";
    list.forEach((data) => {
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>Abastecimento Pipa</h3>
          <span class="pill ${data.status === "completed" ? "completed" : "scheduled"}">
            ${data.status === "completed" ? "Entregue" : "Programado"}
          </span>
        </div>
        <p><strong>Data Prevista:</strong> ${data.scheduledDate || "Em breve"}</p>
        <p><strong>Volume:</strong> ${data.plannedLiters || 0} Litros</p>
        <div class="actions" style="margin-top: 10px;">
          <button class="secondary" data-id="${data.id}">Ver Comprovante</button>
        </div>
      `;
      el.querySelector("button").addEventListener("click", () => mostrarTelaDetalhes(data.id, data));
      container.appendChild(el);
    });
  } catch (e) {
    console.error(e);
  }
}

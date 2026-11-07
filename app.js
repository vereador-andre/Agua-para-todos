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
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAAf5Tfvh0Ow-iusTMuvax5VlxBgjtVFeo",
  authDomain: "agua-para-todos-18167.firebaseapp.com",
  projectId: "agua-para-todos-18167",
  storageBucket: "agua-para-todos-18167.firebasestorage.app",
  messagingSenderId: "154424742994",
  appId: "1:154424742994:web:46f14ccf8fc781e8867b8b"
};

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
  console.error("Erro Firebase:", e);
}

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

let currentUser = null;
let currentUserProfile = null;
let signatureCanvas = null;
let signatureCtx = null;
let isDrawing = false;

if (screenModal) screenModal.classList.add("hidden");

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

if (closeModalBtn) closeModalBtn.addEventListener("click", closeDedicatedScreen);

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 3500);
}

// Login Rápido e Otimizado
async function executarLogin() {
  limparErroLogin();
  let rawInput = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;

  if (!rawInput || !password) {
    exibirErroLogin("Preencha o telefone/e-mail e a senha.");
    return;
  }

  btnSubmitLogin.disabled = true;
  btnSubmitLogin.textContent = "Entrando...";

  let finalLogin = rawInput;
  const digitsOnly = rawInput.replace(/\D/g, "");
  if (!rawInput.includes("@")) {
    if (digitsOnly.length >= 8) {
      finalLogin = `${digitsOnly}@aguaparatodos.com`;
    } else {
      exibirErroLogin("Digite um telefone válido com DDD ou e-mail.");
      btnSubmitLogin.disabled = false;
      btnSubmitLogin.textContent = "Entrar no Sistema";
      return;
    }
  }

  try {
    await signInWithEmailAndPassword(auth, finalLogin, password);
  } catch (err) {
    console.error("Erro login:", err);
    exibirErroLogin("Telefone/E-mail ou senha incorretos.");
  } finally {
    btnSubmitLogin.disabled = false;
    btnSubmitLogin.textContent = "Entrar no Sistema";
  }
}

if (btnSubmitLogin) btnSubmitLogin.addEventListener("click", (e) => { e.preventDefault(); executarLogin(); });
if (loginForm) loginForm.addEventListener("submit", (e) => { e.preventDefault(); executarLogin(); });
if (logoutBtn) logoutBtn.addEventListener("click", async () => { try { await signOut(auth); } catch(e){} finalizarSessao(); });

if (auth) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          currentUserProfile = userSnap.data();
        } else {
          currentUserProfile = { name: user.email.split("@")[0], role: "admin" };
        }
        iniciarSessao();
      } catch (e) {
        currentUserProfile = { name: "Administrador", role: "admin" };
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

  // Nome do usuário logado abaixo do cargo
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
// 1. PAINEL DO ADMINISTRADOR
// ==========================================
async function carregarPainelAdmin() {
  adminPanel.innerHTML = `
    <div class="panel-title">
      <h2>Gestão de Abastecimento</h2>
    </div>

    <!-- Botões padronizados em tamanho, cores e estilo com figurinhas diferentes -->
    <div class="actions" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 18px;">
      <button id="btnNovoImovel" class="primary" type="button" style="justify-content: center;">🏠 Família</button>
      <button id="btnNovoMotorista" class="primary" type="button" style="justify-content: center;">🚚 Motorista</button>
      <button id="btnNovoVeiculo" class="primary" type="button" style="justify-content: center;">🚛 Veículo</button>
      <button id="btnAgendar" class="yellow" type="button" style="justify-content: center;">💧 Agendar</button>
    </div>

    <!-- Estatísticas -->
    <div class="stats">
      <div class="stat"><span>Famílias</span><b id="statFamilias">0</b></div>
      <div class="stat"><span>Motoristas</span><b id="statMotoristas">0</b></div>
      <div class="stat"><span>Veículos</span><b id="statVeiculos">0</b></div>
      <div class="stat"><span>Entregas</span><b id="statEntregas">0</b></div>
    </div>

    <!-- Filtro de Relatórios e Listagem -->
    <div class="panel-title" style="margin-top: 24px;">
      <h2>Relatórios e Cadastros</h2>
    </div>

    <div class="card" style="padding: 12px; margin-bottom: 14px;">
      <div class="row">
        <label style="flex: 1; min-width: 180px;">Filtrar por Categoria:
          <select id="filtroCategoria" style="margin-top: 4px;">
            <option value="todos">Todos os Registros</option>
            <option value="familias">Famílias Rurais</option>
            <option value="motoristas">Motoristas</option>
            <option value="veiculos">Veículos</option>
            <option value="entregas">Entregas e Abastecimentos</option>
          </select>
        </label>
      </div>
    </div>

    <div id="adminRecordsList" class="grid">
      <p class="small">Carregando dados...</p>
    </div>
  `;

  document.getElementById("btnNovoImovel").addEventListener("click", () => mostrarTelaCadastroImovel());
  document.getElementById("btnNovoMotorista").addEventListener("click", () => mostrarTelaCadastroMotorista());
  document.getElementById("btnNovoVeiculo").addEventListener("click", () => mostrarTelaCadastroVeiculo());
  document.getElementById("btnAgendar").addEventListener("click", () => mostrarTelaAgendamento());
  document.getElementById("filtroCategoria").addEventListener("change", () => renderizarListagemAdmin());

  await atualizarDadosAdmin();
}

let cacheGlobalAdmin = { fams: [], mot: [], vei: [], del: [] };

async function atualizarDadosAdmin() {
  try {
    const [snapFam, snapMot, snapVei, snapDel] = await Promise.all([
      getDocs(collection(db, "households")),
      getDocs(collection(db, "drivers")),
      getDocs(collection(db, "vehicles")),
      getDocs(collection(db, "deliveries"))
    ]);

    cacheGlobalAdmin.fams = [];
    snapFam.forEach(d => cacheGlobalAdmin.fams.push({ id: d.id, ...d.data() }));

    cacheGlobalAdmin.mot = [];
    snapMot.forEach(d => cacheGlobalAdmin.mot.push({ id: d.id, ...d.data() }));

    cacheGlobalAdmin.vei = [];
    snapVei.forEach(d => cacheGlobalAdmin.vei.push({ id: d.id, ...d.data() }));

    cacheGlobalAdmin.del = [];
    snapDel.forEach(d => cacheGlobalAdmin.del.push({ id: d.id, ...d.data() }));

    document.getElementById("statFamilias").textContent = cacheGlobalAdmin.fams.length;
    document.getElementById("statMotoristas").textContent = cacheGlobalAdmin.mot.length;
    document.getElementById("statVeiculos").textContent = cacheGlobalAdmin.vei.length;
    document.getElementById("statEntregas").textContent = cacheGlobalAdmin.del.length;

    renderizarListagemAdmin();
  } catch (e) {
    console.error("Erro dados admin:", e);
  }
}

function renderizarListagemAdmin() {
  const container = document.getElementById("adminRecordsList");
  const filtro = document.getElementById("filtroCategoria") ? document.getElementById("filtroCategoria").value : "todos";
  if (!container) return;
  container.innerHTML = "";

  let contador = 0;

  // 1. Famílias
  if (filtro === "todos" || filtro === "familias") {
    cacheGlobalAdmin.fams.forEach(item => {
      contador++;
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>🏠 Família: ${item.name}</h3>
          <span class="pill scheduled">${item.community}</span>
        </div>
        <p><strong>WhatsApp/Login:</strong> ${item.phone} • <strong>Cisterna:</strong> ${item.defaultLiters} L</p>
        <p><strong>Referência:</strong> ${item.address || 'Não informada'}</p>
        <div class="actions" style="margin-top: 10px;">
          <button class="secondary" data-edit-fam="${item.id}">✏️ Alterar</button>
          <button class="danger" data-del-fam="${item.id}">Excluir</button>
        </div>
      `;
      el.querySelector("[data-edit-fam]").addEventListener("click", () => mostrarTelaCadastroImovel(item.id, item));
      el.querySelector("[data-del-fam]").addEventListener("click", async () => {
        if (confirm(`Deseja excluir a família ${item.name}?`)) {
          await deleteDoc(doc(db, "households", item.id));
          showToast("Família excluída!");
          atualizarDadosAdmin();
        }
      });
      container.appendChild(el);
    });
  }

  // 2. Motoristas
  if (filtro === "todos" || filtro === "motoristas") {
    cacheGlobalAdmin.mot.forEach(item => {
      contador++;
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>🚚 Motorista: ${item.name}</h3>
          <span class="pill scheduled">Ativo</span>
        </div>
        <p><strong>WhatsApp/Login:</strong> ${item.phone} • <strong>CPF:</strong> ${item.cpf}</p>
        <div class="actions" style="margin-top: 10px;">
          <button class="secondary" data-edit-mot="${item.id}">✏️ Alterar</button>
          <button class="danger" data-del-mot="${item.id}">Excluir</button>
        </div>
      `;
      el.querySelector("[data-edit-mot]").addEventListener("click", () => mostrarTelaCadastroMotorista(item.id, item));
      el.querySelector("[data-del-mot]").addEventListener("click", async () => {
        if (confirm(`Deseja excluir o motorista ${item.name}?`)) {
          await deleteDoc(doc(db, "drivers", item.id));
          showToast("Motorista excluído!");
          atualizarDadosAdmin();
        }
      });
      container.appendChild(el);
    });
  }

  // 3. Veículos
  if (filtro === "todos" || filtro === "veiculos") {
    cacheGlobalAdmin.vei.forEach(item => {
      contador++;
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>🚛 Veículo: ${item.plate}</h3>
          <span class="pill scheduled">${item.capacity} L</span>
        </div>
        <p><strong>Modelo:</strong> ${item.model} • <strong>KM Cadastro:</strong> ${item.kmCadastro || 0} km</p>
        <div class="actions" style="margin-top: 10px;">
          <button class="secondary" data-edit-vei="${item.id}">✏️ Alterar</button>
          <button class="danger" data-del-vei="${item.id}">Excluir</button>
        </div>
      `;
      el.querySelector("[data-edit-vei]").addEventListener("click", () => mostrarTelaCadastroVeiculo(item.id, item));
      el.querySelector("[data-del-vei]").addEventListener("click", async () => {
        if (confirm(`Deseja excluir o veículo ${item.plate}?`)) {
          await deleteDoc(doc(db, "vehicles", item.id));
          showToast("Veículo excluído!");
          atualizarDadosAdmin();
        }
      });
      container.appendChild(el);
    });
  }

  // 4. Entregas
  if (filtro === "todos" || filtro === "entregas") {
    cacheGlobalAdmin.del.forEach(item => {
      contador++;
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>💧 Entrega: ${item.recipientName}</h3>
          <span class="pill ${item.status === 'completed' ? 'completed' : 'scheduled'}">${item.status === 'completed' ? 'Entregue' : 'Agendada'}</span>
        </div>
        <p><strong>Comunidade:</strong> ${item.community} • <strong>Volume:</strong> ${item.plannedLiters} L</p>
        <p><strong>Motorista:</strong> ${item.driverName || 'Não atribuído'} • <strong>Veículo:</strong> ${item.vehiclePlate || 'Não informado'}</p>
        <p><strong>Data:</strong> ${item.scheduledDate || 'Não informada'}</p>
        <div class="actions" style="margin-top: 10px;">
          <button class="secondary" data-details="${item.id}">Ver Ficha</button>
          <button class="danger" data-del-del="${item.id}">Excluir</button>
        </div>
      `;
      el.querySelector("[data-details]").addEventListener("click", () => mostrarTelaDetalhes(item.id, item));
      el.querySelector("[data-del-del]").addEventListener("click", async () => {
        if (confirm("Deseja excluir este agendamento?")) {
          await deleteDoc(doc(db, "deliveries", item.id));
          showToast("Agendamento excluído!");
          atualizarDadosAdmin();
        }
      });
      container.appendChild(el);
    });
  }

  if (contador === 0) {
    container.innerHTML = `<div class="item"><p>Nenhum registro encontrado para este filtro.</p></div>`;
  }
}

// ------------------------------------------
// Telas de Cadastro e Edição com novos campos
// ------------------------------------------
function mostrarTelaCadastroImovel(editId = null, existingData = null) {
  const html = `
    <form onsubmit="return false;">
      <label>Nome do Responsável <input id="fName" type="text" value="${existingData?.name || ''}" required></label>
      <label>CPF <input id="fCpf" type="text" value="${existingData?.cpf || ''}" required></label>
      <label>Telefone / WhatsApp (Login) <input id="fPhone" type="text" value="${existingData?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha de Acesso <input id="fPass" type="password" value="${existingData?.password || '123456'}" required></label>
      <label>Comunidade / Assentamento <input id="fComm" type="text" value="${existingData?.community || ''}" required></label>
      <label>Ponto de Referência <input id="fAddr" type="text" value="${existingData?.address || ''}"></label>
      <label>Volume da Cisterna (Litros) <input id="fLit" type="number" step="500" value="${existingData?.defaultLiters || 5000}" required></label>
      <div class="actions" style="margin-top: 15px;">
        <button id="btnSaveFam" type="button" class="primary" style="flex:2;">${editId ? 'Salvar Alterações' : 'Cadastrar Família'}</button>
        <button type="button" class="secondary" id="btnCancel" style="flex:1;">Voltar</button>
      </div>
    </form>
  `;
  openDedicatedScreen(editId ? "Editar Família Rural" : "Cadastrar Família Rural", html);
  document.getElementById("btnCancel").addEventListener("click", closeDedicatedScreen);

  document.getElementById("btnSaveFam").addEventListener("click", async () => {
    const phone = document.getElementById("fPhone").value.trim();
    const pass = document.getElementById("fPass").value;
    const digits = phone.replace(/\D/g, "");
    const emailLogin = `${digits}@aguaparatodos.com`;

    const dataObj = {
      name: document.getElementById("fName").value.trim(),
      cpf: document.getElementById("fCpf").value.trim(),
      phone: phone,
      password: pass,
      community: document.getElementById("fComm").value.trim(),
      address: document.getElementById("fAddr").value.trim(),
      defaultLiters: Number(document.getElementById("fLit").value),
      role: "recipient"
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "households", editId), dataObj);
        showToast("Família atualizada com sucesso!");
      } else {
        const cred = await setDocAuthAndFirestore(emailLogin, pass, dataObj, "households", dataObj.name, "recipient");
      }
      closeDedicatedScreen();
      atualizarDadosAdmin();
    } catch(e) {
      alert("Erro ao salvar: " + e.message);
    }
  });
}

function mostrarTelaCadastroMotorista(editId = null, existingData = null) {
  const html = `
    <form onsubmit="return false;">
      <label>Nome do Motorista <input id="mName" type="text" value="${existingData?.name || ''}" required></label>
      <label>CPF <input id="mCpf" type="text" value="${existingData?.cpf || ''}" required></label>
      <label>Telefone / WhatsApp (Login) <input id="mPhone" type="text" value="${existingData?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha de Acesso <input id="mPass" type="password" value="${existingData?.password || '123456'}" required></label>
      <div class="actions" style="margin-top: 15px;">
        <button id="btnSaveMot" type="button" class="primary" style="flex:2;">${editId ? 'Salvar Alterações' : 'Cadastrar Motorista'}</button>
        <button type="button" class="secondary" id="btnCancel" style="flex:1;">Voltar</button>
      </div>
    </form>
  `;
  openDedicatedScreen(editId ? "Editar Motorista" : "Cadastrar Motorista", html);
  document.getElementById("btnCancel").addEventListener("click", closeDedicatedScreen);

  document.getElementById("btnSaveMot").addEventListener("click", async () => {
    const phone = document.getElementById("mPhone").value.trim();
    const pass = document.getElementById("mPass").value;
    const digits = phone.replace(/\D/g, "");
    const emailLogin = `${digits}@aguaparatodos.com`;

    const dataObj = {
      name: document.getElementById("mName").value.trim(),
      cpf: document.getElementById("mCpf").value.trim(),
      phone: phone,
      password: pass,
      role: "driver"
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "drivers", editId), dataObj);
        showToast("Motorista atualizado!");
      } else {
        await setDocAuthAndFirestore(emailLogin, pass, dataObj, "drivers", dataObj.name, "driver");
      }
      closeDedicatedScreen();
      atualizarDadosAdmin();
    } catch(e) {
      alert("Erro: " + e.message);
    }
  });
}

function mostrarTelaCadastroVeiculo(editId = null, existingData = null) {
  const html = `
    <form onsubmit="return false;">
      <label>Placa do Veículo <input id="vPlate" type="text" value="${existingData?.plate || ''}" placeholder="ABC-1234" required></label>
      <label>Modelo / Descrição <input id="vModel" type="text" value="${existingData?.model || ''}" placeholder="Mercedes 15.000L" required></label>
      <label>Capacidade (Litros) <input id="vCap" type="number" step="500" value="${existingData?.capacity || 15000}" required></label>
      <label>KM na Data do Cadastro <input id="vKm" type="number" value="${existingData?.kmCadastro || 0}" required></label>
      <div class="actions" style="margin-top: 15px;">
        <button id="btnSaveVei" type="button" class="primary" style="flex:2;">${editId ? 'Salvar Alterações' : 'Cadastrar Veículo'}</button>
        <button type="button" class="secondary" id="btnCancel" style="flex:1;">Voltar</button>
      </div>
    </form>
  `;
  openDedicatedScreen(editId ? "Editar Veículo" : "Cadastrar Veículo", html);
  document.getElementById("btnCancel").addEventListener("click", closeDedicatedScreen);

  document.getElementById("btnSaveVei").addEventListener("click", async () => {
    const dataObj = {
      plate: document.getElementById("vPlate").value.trim(),
      model: document.getElementById("vModel").value.trim(),
      capacity: Number(document.getElementById("vCap").value),
      kmCadastro: Number(document.getElementById("vKm").value)
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "vehicles", editId), dataObj);
        showToast("Veículo atualizado!");
      } else {
        await addDoc(collection(db, "vehicles"), { ...dataObj, createdAt: serverTimestamp() });
        showToast("Veículo cadastrado!");
      }
      closeDedicatedScreen();
      atualizarDadosAdmin();
    } catch(e) {
      alert("Erro: " + e.message);
    }
  });
}

async function mostrarTelaAgendamento() {
  const html = `
    <form onsubmit="return false;">
      <label>Selecione a Família <select id="selFam" required><option value="">Carregando...</option></select></label>
      <label>Selecione o Motorista <select id="selMot" required><option value="">Carregando...</option></select></label>
      <label>Selecione o Veículo <select id="selVei" required><option value="">Carregando...</option></select></label>
      <label>Data Prevista <input id="agDate" type="date" required></label>
      <label>Volume de Entrega (Litros) <input id="agLit" type="number" step="500" value="5000" required></label>
      <div class="actions" style="margin-top: 15px;">
        <button id="btnSaveAg" type="button" class="primary" style="flex:2;">Confirmar Agendamento</button>
        <button type="button" class="secondary" id="btnCancel" style="flex:1;">Voltar</button>
      </div>
    </form>
  `;
  openDedicatedScreen("Agendar Entrega de Pipa", html);
  document.getElementById("btnCancel").addEventListener("click", closeDedicatedScreen);

  const selFam = document.getElementById("selFam");
  const selMot = document.getElementById("selMot");
  const selVei = document.getElementById("selVei");
  let fams = [];

  try {
    const [snapF, snapM, snapV] = await Promise.all([
      getDocs(collection(db, "households")),
      getDocs(collection(db, "drivers")),
      getDocs(collection(db, "vehicles"))
    ]);

    selFam.innerHTML = '<option value="">Selecione a família...</option>';
    snapF.forEach(d => {
      fams.push({ id: d.id, ...d.data() });
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = `${d.data().name} (${d.data().community})`;
      selFam.appendChild(opt);
    });

    selMot.innerHTML = '<option value="">Selecione o motorista...</option>';
    snapM.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.data().name;
      opt.textContent = d.data().name;
      selMot.appendChild(opt);
    });

    selVei.innerHTML = '<option value="">Selecione o veículo...</option>';
    snapV.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.data().plate;
      opt.textContent = `${d.data().plate} - ${d.data().model}`;
      selVei.appendChild(opt);
    });
  } catch(e) {}

  selFam.addEventListener("change", () => {
    const f = fams.find(x => x.id === selFam.value);
    if(f && f.defaultLiters) document.getElementById("agLit").value = f.defaultLiters;
  });

  document.getElementById("btnSaveAg").addEventListener("click", async () => {
    const fId = selFam.value;
    const fam = fams.find(x => x.id === fId);
    if(!fam) { alert("Selecione uma família"); return; }

    try {
      await addDoc(collection(db, "deliveries"), {
        householdId: fId,
        recipientName: fam.name,
        community: fam.community,
        address: fam.address,
        driverName: selMot.value,
        vehiclePlate: selVei.value,
        scheduledDate: document.getElementById("agDate").value,
        plannedLiters: Number(document.getElementById("agLit").value),
        status: "scheduled",
        createdAt: serverTimestamp()
      });
      showToast("Entrega agendada com sucesso!");
      closeDedicatedScreen();
      atualizarDadosAdmin();
    } catch(e) {
      alert("Erro: " + e.message);
    }
  });
}

// Auxiliar para criar login automático no Firebase Auth
async function setDocAuthAndFirestore(email, password, dataObj, collectionName, userName, role) {
  // Import dinâmico interno para auth creation
  const { createUserWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, collectionName, cred.user.uid), dataObj);
    await setDoc(doc(db, "users", cred.user.uid), { name: userName, role: role });
    showToast("Cadastro realizado com sucesso!");
  } catch(err) {
    if (err.code === "auth/email-already-in-use") {
      // Se o email já existe, grava direto no firestore
      await addDoc(collection(db, collectionName), dataObj);
      showToast("Salvo com sucesso!");
    } else {
      throw err;
    }
  }
}

// ==========================================
// 2. PAINEL DO MOTORISTA
// ==========================================
async function carregarPainelMotorista() {
  driverPanel.innerHTML = `
    <div class="panel-title">
      <h2>Entregas Atribuídas</h2>
      <button id="btnRelMot" class="secondary" type="button">Atualizar</button>
    </div>
    <div id="driverList" class="grid"><p class="small">Buscando entregas...</p></div>
  `;
  document.getElementById("btnRelMot").addEventListener("click", carregarEntregasMotorista);
  await carregarEntregasMotorista();
}

async function carregarEntregasMotorista() {
  const container = document.getElementById("driverList");
  try {
    const snap = await getDocs(collection(db, "deliveries"));
    if(snap.empty) { container.innerHTML = `<div class="item"><p>Nenhuma entrega programada.</p></div>`; return; }
    
    container.innerHTML = "";
    snap.forEach(d => {
      const data = d.data();
      // Exibe se o motorista for o logado ou se não tiver filtro restrito
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>💧 ${data.recipientName}</h3>
          <span class="pill ${data.status === 'completed' ? 'completed' : 'scheduled'}">${data.status === 'completed' ? 'Entregue' : 'Pendente'}</span>
        </div>
        <p><strong>Comunidade:</strong> ${data.community} • <strong>Volume:</strong> ${data.plannedLiters} L</p>
        <p><strong>Veículo:</strong> ${data.vehiclePlate || 'Não informado'} • <strong>Data:</strong> ${data.scheduledDate || 'Hoje'}</p>
        <div class="actions" style="margin-top: 10px;">
          ${data.status !== 'completed' ? `<button class="primary" data-sup="${d.id}">Realizar Abastecimento</button>` : ''}
          <button class="secondary" data-det="${d.id}">Ver Ficha</button>
        </div>
      `;
      if(data.status !== 'completed') {
        el.querySelector("[data-sup]").addEventListener("click", () => mostrarTelaAbastecimento(d.id, data));
      }
      el.querySelector("[data-det]").addEventListener("click", () => mostrarTelaDetalhes(d.id, data));
      container.appendChild(el);
    });
  } catch(e) {}
}

function mostrarTelaAbastecimento(id, data) {
  const html = `
    <form onsubmit="return false;">
      <div class="notice"><strong>${data.recipientName}</strong><br>${data.community} • ${data.plannedLiters} L</div>
      <label>Volume Entregue (Litros) <input id="rLit" type="number" value="${data.plannedLiters}" required></label>
      <label>Responsável Presente? 
        <select id="rPres"><option value="sim">Sim</option><option value="nao">Não (Cisterna fechada)</option></select>
      </label>
      <label>Foto do Abastecimento <input id="rPhoto" type="file" accept="image/*" capture="environment"></label>
      <img id="prevImg" class="photo-preview hidden" alt="Foto">
      <label>Assinatura do Beneficiário <canvas id="signCanvas" class="signature"></canvas></label>
      <button id="btnClearSign" type="button" class="secondary" style="padding:6px;">Limpar Assinatura</button>
      <label>Observações <textarea id="rObs"></textarea></label>
      <div class="actions" style="margin-top: 15px;">
        <button id="btnFinalizar" type="button" class="primary" style="flex:2;">Salvar e Confirmar Entrega</button>
        <button type="button" class="secondary" id="btnCancel" style="flex:1;">Voltar</button>
      </div>
    </form>
  `;
  openDedicatedScreen("Registrar Abastecimento", html);
  document.getElementById("btnCancel").addEventListener("click", closeDedicatedScreen);

  signatureCanvas = document.getElementById("signCanvas");
  if(signatureCanvas) {
    signatureCtx = signatureCanvas.getContext("2d");
    const r = signatureCanvas.getBoundingClientRect();
    signatureCanvas.width = r.width; signatureCanvas.height = r.height;
    signatureCtx.strokeStyle = "#0D2B5C"; signatureCtx.lineWidth = 3;

    const pos = e => {
      const rect = signatureCanvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - rect.left, y: cy - rect.top };
    };
    const start = e => { isDrawing = true; const p = pos(e); signatureCtx.beginPath(); signatureCtx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = e => { if(!isDrawing) return; const p = pos(e); signatureCtx.lineTo(p.x, p.y); signatureCtx.stroke(); e.preventDefault(); };
    const stop = () => isDrawing = false;

    signatureCanvas.addEventListener("mousedown", start); signatureCanvas.addEventListener("mousemove", move); window.addEventListener("mouseup", stop);
    signatureCanvas.addEventListener("touchstart", start, {passive:false}); signatureCanvas.addEventListener("touchmove", move, {passive:false}); window.addEventListener("touchend", stop);
  }

  document.getElementById("btnClearSign").addEventListener("click", () => signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height));

  const pInput = document.getElementById("rPhoto");
  const pPrev = document.getElementById("prevImg");
  pInput.addEventListener("change", e => {
    const f = e.target.files[0];
    if(f) {
      const r = new FileReader();
      r.onload = ev => { pPrev.src = ev.target.result; pPrev.classList.remove("hidden"); };
      r.readAsDataURL(f);
    }
  });

  document.getElementById("btnFinalizar").addEventListener("click", async () => {
    try {
      let photoUrl = "";
      if(pInput.files[0]) {
        const sRef = storageRef(storage, `entregas/${id}_${Date.now()}.jpg`);
        await uploadBytes(sRef, pInput.files[0]);
        photoUrl = await getDownloadURL(sRef);
      }
      const sigData = signatureCanvas ? signatureCanvas.toDataURL("image/png") : null;

      await updateDoc(doc(db, "deliveries", id), {
        status: "completed",
        receivedLiters: Number(document.getElementById("rLit").value),
        recipientPresent: document.getElementById("rPres").value === "sim",
        note: document.getElementById("rObs").value,
        photoUrl,
        signatureData: sigData,
        completedAt: serverTimestamp()
      });
      showToast("Abastecimento registrado com sucesso!");
      closeDedicatedScreen();
      carregarEntregasMotorista();
    } catch(e) {
      alert("Erro ao gravar: " + e.message);
    }
  });
}

// ==========================================
// 3. PAINEL DO BENEFICIÁRIO (FAMÍLIA)
// ==========================================
async function carregarPainelBeneficiario() {
  recipientPanel.innerHTML = `
    <div class="panel-title">
      <h2>Meus Abastecimentos e Confirmação</h2>
      <button id="btnRecRel" class="secondary" type="button">Atualizar</button>
    </div>
    <div id="recList" class="grid"><p class="small">Buscando suas entregas...</p></div>
  `;
  document.getElementById("btnRecRel").addEventListener("click", carregarHistoricoBeneficiario);
  await carregarHistoricoBeneficiario();
}

async function carregarHistoricoBeneficiario() {
  const container = document.getElementById("recList");
  try {
    const snap = await getDocs(collection(db, "deliveries"));
    container.innerHTML = "";
    let count = 0;

    snap.forEach(d => {
      const data = d.data();
      if (data.recipientName && currentUserProfile && data.recipientName.toLowerCase() === currentUserProfile.name.toLowerCase()) {
        count++;
        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `
          <div class="row">
            <h3>💧 Abastecimento Pipa</h3>
            <span class="pill ${data.status === 'completed' ? 'completed' : 'scheduled'}">${data.status === 'completed' ? 'Recebido' : 'Programado'}</span>
          </div>
          <p><strong>Data:</strong> ${data.scheduledDate || 'Em breve'}</p>
          <p><strong>Volume:</strong> ${data.plannedLiters} Litros</p>
          <div class="actions" style="margin-top: 10px;">
            <button class="secondary" data-det="${d.id}">Ver Comprovante</button>
          </div>
        `;
        el.querySelector("[data-det]").addEventListener("click", () => mostrarTelaDetalhes(d.id, data));
        container.appendChild(el);
      }
    });

    if(count === 0) {
      container.innerHTML = `<div class="item"><p>Nenhum abastecimento programado para sua família no momento.</p></div>`;
    }
  } catch(e) {}
}

function mostrarTelaDetalhes(id, data) {
  const html = `
    <div style="display:grid; gap:12px;">
      <p><strong>Família:</strong> ${data.recipientName}</p>
      <p><strong>Comunidade:</strong> ${data.community}</p>
      <p><strong>Motorista:</strong> ${data.driverName || 'Não informado'}</p>
      <p><strong>Veículo:</strong> ${data.vehiclePlate || 'Não informado'}</p>
      <p><strong>Volume Previsto:</strong> ${data.plannedLiters} L</p>
      <p><strong>Volume Entregue:</strong> ${data.receivedLiters ? data.receivedLiters + ' L' : 'Pendente'}</p>
      <p><strong>Status:</strong> ${data.status === 'completed' ? 'Concluído' : 'Agendado'}</p>
      ${data.note ? `<p><strong>Observações:</strong> ${data.note}</p>` : ''}
      ${data.photoUrl ? `<p><strong>Foto:</strong></p><img src="${data.photoUrl}" class="photo-preview" alt="Foto">` : ''}
      ${data.signatureData ? `<p><strong>Assinatura:</strong></p><img src="${data.signatureData}" style="max-height:100px;border:1px solid #ccc;border-radius:8px;" alt="Assinatura">` : ''}
      <div class="actions" style="margin-top:15px;"><button type="button" class="secondary" id="btnCloseDet" style="width:100%;">Fechar</button></div>
    </div>
  `;
  openDedicatedScreen("Comprovante de Abastecimento", html);
  document.getElementById("btnCloseDet").addEventListener("click", closeDedicatedScreen);
}

import { auth, db, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { 
  user: null, 
  profile: null, 
  households: [], 
  deliveries: [], 
  drivers: [], 
  vehicles: [],
  resetRequests: [],
  filteredReportData: [],
  filters: { category: null, searchTerm: "" }
};

let secondaryApp = null, secondaryAuth = null;
try {
  secondaryApp = initializeApp(firebaseConfig, "DriverRegistrationApp");
  secondaryAuth = getAuth(secondaryApp);
} catch (e) {}

/* HIGIENIZAÇÃO DE TEXTO E MÁSCARAS */
function sanitizeText(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function attachUppercaseNoAccent(input) {
  input.oninput = e => {
    const cursor = e.target.selectionStart;
    e.target.value = sanitizeText(e.target.value);
    e.target.setSelectionRange(cursor, cursor);
  };
}

function applyPhoneMask(input) {
  input.oninput = e => {
    let v = e.target.value.replace(/\D/g, "").slice(0, 11);
    if (v.length > 10) {
      v = v.replace(/^(\d{2})(\d{5})(\d{4}).*/, "($1) $2-$3");
    } else if (v.length > 6) {
      v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    } else if (v.length > 2) {
      v = v.replace(/^(\d{2})(\d{0,5})/, "($1) $2");
    } else if (v.length > 0) {
      v = v.replace(/^(\d*)/, "($1");
    }
    e.target.value = v;
  };
}

function applyPlateMask(input) {
  input.oninput = e => {
    let v = sanitizeText(e.target.value).replace(/[^A-Z0-9]/g, "").slice(0, 7);
    if (v.length > 3) {
      v = v.slice(0, 3) + "-" + v.slice(3);
    }
    e.target.value = v;
  };
}

function normalizePhone(val) {
  return String(val || "").replace(/\D/g, "");
}

function phoneAuthEmail(phone) {
  const d = normalizePhone(phone);
  if (d.length < 10 || d.length > 11) throw new Error("Informe um telefone com DDD válido.");
  return `usuario.${d}@agua-para-todos.app`;
}

function loginIdentifierToEmail(id) {
  const v = String(id || "").trim();
  if (v.includes("@")) return v.toLowerCase();
  const d = normalizePhone(v);
  if (d.length >= 10) {
    return `usuario.${d}@agua-para-todos.app`;
  }
  return v.toLowerCase();
}

function updateConnectionStatus() {
  const el = $("connectionStatus");
  if (!el) return;
  if (!state.user) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  if (navigator.onLine) {
    el.textContent = "Online • Sistema Conectado";
    el.classList.add("ok");
  } else {
    el.textContent = "Sem Internet • Modo Offline Ativo";
    el.classList.remove("ok");
  }
}
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

if ($("logoutBtn")) $("logoutBtn").onclick = () => signOut(auth);
if ($("closeModal")) $("closeModal").onclick = closeModal;
if ($("modal")) $("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };

function toast(msg) {
  if (!$("toast")) return;
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 3500);
}

function openModal(html) {
  $("modalContent").innerHTML = html;
  $("modal").classList.remove("hidden");
  document.body.classList.add("no-scroll");
}

function closeModal() {
  if ($("modal")) $("modal").classList.add("hidden");
  if ($("modalContent")) $("modalContent").innerHTML = "";
  document.body.classList.remove("no-scroll");
}

function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
}

function dateOnly(v) {
  if (!v) return "—";
  return new Date(v + "T12:00:00").toLocaleDateString("pt-BR");
}

function translateStatus(status) {
  switch (status) {
    case 'completed': return { text: 'Realizada', class: 'completed' };
    case 'pending': return { text: 'Ausência (Pendente)', class: 'pending' };
    case 'disputed': return { text: 'Contestado', class: 'danger' };
    case 'scheduled': default: return { text: 'Programada', class: 'scheduled' };
  }
}

/* CONFIRMAÇÃO SEGURA DE EXCLUSÃO */
function confirmSecureDelete(itemName, callback) {
  openModal(`
    <div style="text-align:center; padding:10px;">
      <div style="font-size:38px; margin-bottom:8px;">⚠️</div>
      <h2 style="font-size:18px; font-weight:800; color:var(--danger); margin-bottom:10px;">Atenção: Exclusão Irreversível</h2>
      <p class="small" style="margin-bottom:16px; color:#334155;">Você está prestes a excluir <b>${esc(itemName)}</b>.<br>Tem certeza que deseja continuar? <b>Não será possível recuperar</b> estes dados posteriormente.</p>
      <div style="display:flex; gap:10px;">
        <button type="button" class="secondary" id="btnCancelDel" style="flex:1;">Cancelar</button>
        <button type="button" class="danger" id="btnConfirmDel" style="flex:1;">🗑️ Sim, Excluir Definitivamente</button>
      </div>
    </div>
  `);
  $("btnCancelDel").onclick = closeModal;
  $("btnConfirmDel").onclick = () => {
    closeModal();
    callback();
  };
}

/* LOGIN NORMAL */
if ($("loginForm")) {
  $("loginForm").onsubmit = async e => {
    e.preventDefault();
    if ($("loginMsg")) $("loginMsg").textContent = "Verificando acesso...";
    try {
      const rawInput = $("loginEmail").value.trim();
      const email = loginIdentifierToEmail(rawInput);
      const password = $("loginPassword").value.trim();
      
      await signInWithEmailAndPassword(auth, email, password);
      if ($("loginMsg")) $("loginMsg").textContent = "";
    } catch (err) {
      console.error("Erro de login:", err.code, err.message);
      if ($("loginMsg")) {
        $("loginMsg").textContent = "Acesso negado: Verifique o e-mail/telefone e a senha informados.";
      }
    }
  };
}

/* RECUPERAÇÃO DE SENHA */
if ($("forgotPasswordLink")) {
  $("forgotPasswordLink").onclick = e => {
    e.preventDefault();
    showForgotPasswordModal();
  };
}

function showForgotPasswordModal() {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 10px;">🔑 Recuperação Segura de Senha</h2>
    <p class="small" style="margin-bottom: 16px;">Informe seus dados cadastrados para validar seu acesso na base do programa:</p>

    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
      <button type="button" class="primary small" id="tabPhone" style="flex:1;">📱 Telefone (Família/Motorista)</button>
      <button type="button" class="secondary small" id="tabEmail" style="flex:1;">📧 E-mail (Admin)</button>
    </div>

    <div id="recoveryPhoneContainer">
      <form id="recoveryPhoneForm">
        <label>Telefone / WhatsApp Cadastrado <input id="recPhone" type="tel" placeholder="(84) 99999-9999" required></label>
        <label>Confirme seu Nome Completo (para validação) <input id="recConfirmName" type="text" placeholder="Digite seu nome cadastrado" required></label>
        <p id="recPhoneErr" class="small" style="color:var(--danger); font-weight:700; margin-bottom:10px;"></p>
        <button type="submit" id="btnVerifyPhone" class="primary" style="width:100%;">🔍 Verificar Cadastro e Solicitar Senha</button>
      </form>

      <div id="phoneSuccessBox" class="hidden" style="margin-top:14px; background:#f0fdf4; border:1.5px solid #86efac; padding:14px; border-radius:14px;">
        <p class="small" style="color:#166534; font-weight:800;">✅ CADASTRO VALIDADO COM SUCESSO!</p>
        <p class="small" style="color:#15803d; margin-top:6px;" id="validatedUserSummary"></p>
        <p class="small" style="color:#334155; margin-top:8px;">Por segurança, uma solicitação oficial de redefinição de senha foi registrada para o Administrador. Clique abaixo para agilizar o recebimento da sua nova senha de 6 dígitos via WhatsApp:</p>
        <a id="waResetLink" href="#" target="_blank" style="display:block; text-align:center; background:#25d366; color:#fff; font-weight:800; font-size:13px; padding:12px; border-radius:12px; text-decoration:none; margin-top:10px;">
          💬 Solicitar Nova Senha no WhatsApp do Suporte
        </a>
      </div>
    </div>

    <div id="recoveryEmailContainer" class="hidden">
      <form id="recoveryEmailForm">
        <label>E-mail Cadastrado <input id="recEmail" type="email" placeholder="seuemail@dominio.com.br" required></label>
        <p id="recEmailErr" class="small" style="color:var(--danger); font-weight:700; margin-bottom:10px;"></p>
        <button type="submit" id="btnVerifyEmail" class="primary" style="width:100%;">📩 Validar E-mail e Enviar Link</button>
      </form>
    </div>
  `);

  applyPhoneMask($("recPhone"));
  attachUppercaseNoAccent($("recConfirmName"));

  $("tabPhone").onclick = () => {
    $("tabPhone").className = "primary small";
    $("tabEmail").className = "secondary small";
    $("recoveryPhoneContainer").classList.remove("hidden");
    $("recoveryEmailContainer").classList.add("hidden");
  };

  $("tabEmail").onclick = () => {
    $("tabEmail").className = "primary small";
    $("tabPhone").className = "secondary small";
    $("recoveryEmailContainer").classList.remove("hidden");
    $("recoveryPhoneContainer").classList.add("hidden");
  };

  $("recoveryPhoneForm").onsubmit = async e => {
    e.preventDefault();
    const errEl = $("recPhoneErr");
    errEl.textContent = "";
    $("phoneSuccessBox").classList.add("hidden");

    const rawPhone = $("recPhone").value.trim();
    const cleanPhone = normalizePhone(rawPhone);
    const inputName = sanitizeText($("recConfirmName").value.trim());

    if (cleanPhone.length < 10) {
      errEl.textContent = "Informe um número de telefone válido com DDD.";
      return;
    }

    const btn = $("btnVerifyPhone");
    btn.disabled = true;
    btn.textContent = "Verificando na base de dados...";

    try {
      const generatedAuthEmail = `usuario.${cleanPhone}@agua-para-todos.app`;
      const qUser = query(collection(db, "users"), where("authEmail", "==", generatedAuthEmail));
      const snap = await getDocs(qUser);

      if (snap.empty) {
        errEl.textContent = "❌ Este telefone não encontra-se na base de dados.";
        btn.disabled = false;
        btn.textContent = "🔍 Verificar Cadastro e Solicitar Senha";
        return;
      }

      const userData = snap.docs[0].data();
      const userId = snap.docs[0].id;
      const dbName = sanitizeText(userData.name || "");

      const firstInputWord = inputName.split(" ")[0];
      const firstDbWord = dbName.split(" ")[0];

      if (!dbName.includes(inputName) && firstInputWord !== firstDbWord) {
        errEl.textContent = "❌ O nome informado não corresponde ao telefone cadastrado.";
        btn.disabled = false;
        btn.textContent = "🔍 Verificar Cadastro e Solicitar Senha";
        return;
      }

      await addDoc(collection(db, "password_resets"), {
        userId,
        userName: userData.name,
        phone: rawPhone,
        role: userData.role,
        status: "pending",
        createdAt: serverTimestamp()
      });

      const roleLabel = userData.role === "driver" ? "Motorista" : "Família Beneficiária";
      $("validatedUserSummary").innerHTML = `<b>Usuário:</b> ${esc(userData.name)} (${roleLabel})<br><b>Telefone:</b> ${esc(rawPhone)}`;

      const waText = encodeURIComponent(`Olá! Esqueci minha senha do sistema Água para Todos.\n\n*Nome:* ${userData.name}\n*Perfil:* ${roleLabel}\n*Telefone de Acesso:* ${rawPhone}\n\nJá validei meu cadastro no aplicativo e solicito uma nova senha de 6 dígitos.`);
      $("waResetLink").href = `https://wa.me/5584999999999?text=${waText}`;

      $("phoneSuccessBox").classList.remove("hidden");
      btn.textContent = "✅ Solicitação Registrada";
      toast("Cadastro localizado! Solicitação enviada ao administrador.");
    } catch (err) {
      console.error(err);
      errEl.textContent = "Erro ao consultar a base de dados. Tente novamente.";
      btn.disabled = false;
      btn.textContent = "🔍 Verificar Cadastro e Solicitar Senha";
    }
  };

  $("recoveryEmailForm").onsubmit = async e => {
    e.preventDefault();
    const errEl = $("recEmailErr");
    errEl.textContent = "";

    const email = $("recEmail").value.trim().toLowerCase();
    const btn = $("btnVerifyEmail");
    btn.disabled = true;
    btn.textContent = "Verificando e-mail...";

    try {
      const qEmail = query(collection(db, "users"), where("email", "==", email));
      const qAuthEmail = query(collection(db, "users"), where("authEmail", "==", email));
      const [snap1, snap2] = await Promise.all([getDocs(qEmail), getDocs(qAuthEmail)]);

      if (snap1.empty && snap2.empty) {
        errEl.textContent = "❌ E-mail não encontra-se na base de dados.";
        btn.disabled = false;
        btn.textContent = "📩 Validar E-mail e Enviar Link";
        return;
      }

      await sendPasswordResetEmail(auth, email);
      toast("✅ Link de redefinição enviado para o seu e-mail!");
      closeModal();
    } catch (err) {
      console.error(err);
      errEl.textContent = "❌ E-mail não encontra-se na base de dados ou é inválido.";
      btn.disabled = false;
      btn.textContent = "📩 Validar E-mail e Enviar Link";
    }
  };
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    state.user = null; state.profile = null;
    updateConnectionStatus();
    if ($("loginView")) $("loginView").classList.remove("hidden");
    if ($("appView")) $("appView").classList.add("hidden");
    return;
  }

  state.user = user;
  updateConnectionStatus();
  if ($("loginView")) $("loginView").classList.add("hidden");
  if ($("appView")) $("appView").classList.remove("hidden");

  try {
    let snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      state.profile = { id: snap.id, ...snap.data() };
    } else {
      const qUser = query(collection(db, "users"), where("authEmail", "==", user.email));
      const snapQ = await getDocs(qUser);
      if (!snapQ.empty) {
        state.profile = { id: snapQ.docs[0].id, ...snapQ.docs[0].data() };
      } else {
        // Fallback caso o usuário seja morador cadastrado na coleção households com e-mail de telefone
        const phoneDigits = user.email.replace("usuario.", "").replace("@agua-para-todos.app", "");
        const allH = await getDocs(collection(db, "households"));
        const foundH = allH.docs.find(d => normalizePhone(d.data().phone) === phoneDigits);
        if (foundH) {
          state.profile = { id: user.uid, name: foundH.data().name, phone: foundH.data().phone, role: "recipient", householdId: foundH.id };
        }
      }
    }

    if (!state.profile) { toast("Usuário autenticado, mas perfil não encontrado."); return; }

    if ($("userName")) $("userName").textContent = state.profile.name || "USUÁRIO";
    if ($("userRole")) $("userRole").textContent = state.profile.role === "admin" ? "Administrador" : state.profile.role === "driver" ? "Motorista" : "Beneficiário";
    if ($("userAvatar")) $("userAvatar").textContent = state.profile.role === "admin" ? "🛡️" : state.profile.role === "driver" ? "👤" : "🏡";

    await renderByRole();
  } catch (err) {
    console.error(err);
    toast("Erro ao carregar sessão.");
  }
});

async function renderByRole() {
  ["adminPanel", "driverPanel", "recipientPanel"].forEach(id => { if ($(id)) $(id).classList.add("hidden"); });
  if (state.profile.role === "admin") {
    if ($("adminPanel")) $("adminPanel").classList.remove("hidden");
    await renderAdmin();
  } else if (state.profile.role === "driver") {
    if ($("driverPanel")) $("driverPanel").classList.remove("hidden");
    await renderDriver();
  } else if (state.profile.role === "recipient") {
    if ($("recipientPanel")) $("recipientPanel").classList.remove("hidden");
    await renderRecipient();
  }
}

/* =========================================================
   BACKUP AUTOMÁTICO DIÁRIO E EXPORTAÇÃO DE SEGURANÇA
========================================================= */
async function checkAndRunDailyBackup() {
  const todayStr = new Date().toISOString().split("T")[0];
  const lastBackupDate = localStorage.getItem("agua_para_todos_last_backup");

  if (lastBackupDate !== todayStr && state.deliveries.length > 0) {
    try {
      await setDoc(doc(db, "system_backups", todayStr), {
        date: todayStr,
        createdAt: serverTimestamp(),
        totalHouseholds: state.households.length,
        totalDrivers: state.drivers.length,
        totalVehicles: state.vehicles.length,
        totalDeliveries: state.deliveries.length,
        snapshotJson: JSON.stringify({
          households: state.households,
          drivers: state.drivers,
          vehicles: state.vehicles,
          deliveries: state.deliveries.map(d => ({ ...d, photoUrl: d.photoUrl ? "[FOTO_ANEXADA]" : "" }))
        })
      });
      localStorage.setItem("agua_para_todos_last_backup", todayStr);
      toast(`✅ Backup automático diário (${dateOnly(todayStr)}) salvo na nuvem!`);
    } catch (e) {
      console.warn("Aviso no backup automático:", e);
    }
  }
}

function downloadFullBackupFile() {
  const todayStr = new Date().toISOString().split("T")[0];
  const backupData = {
    sistema: "Água para Todos - Areia Branca/RN",
    dataBackup: new Date().toLocaleString("pt-BR"),
    resumo: {
      familias: state.households.length,
      motoristas: state.drivers.length,
      veiculos: state.vehicles.length,
      entregas: state.deliveries.length
    },
    familias: state.households,
    motoristas: state.drivers,
    veiculos: state.vehicles,
    entregas: state.deliveries
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BACKUP_COMPLETO_AGUA_PARA_TODOS_${todayStr}.json`;
  a.click();
  toast("📦 Arquivo de backup completo baixado com sucesso!");
}

/* =========================================================
   PAINEL DO ADMINISTRADOR
========================================================= */
async function renderAdmin() {
  try {
    const [snapF, snapD, snapM, snapV, snapR] = await Promise.all([
      getDocs(collection(db, "households")),
      getDocs(query(collection(db, "deliveries"), limit(500))),
      getDocs(query(collection(db, "users"), where("role", "==", "driver"))),
      getDocs(collection(db, "vehicles")),
      getDocs(query(collection(db, "password_resets"), where("status", "==", "pending")))
    ]);

    state.households = snapF.docs.map(d => ({ id: d.id, ...d.data() }));
    state.deliveries = snapD.docs.map(d => ({ id: d.id, ...d.data() }));
    state.drivers = snapM.docs.map(d => ({ id: d.id, ...d.data() }));
    state.vehicles = snapV.docs.map(d => ({ id: d.id, ...d.data() }));
    state.resetRequests = snapR.docs.map(d => ({ id: d.id, ...d.data() }));

    renderAdminDashboard();
    checkAndRunDailyBackup();
  } catch (err) {
    console.error(err);
  }
}

function renderAdminDashboard() {
  const scheduledCount = state.deliveries.filter(d => d.status === "scheduled").length;
  const completedCount = state.deliveries.filter(d => d.status === "completed").length;
  const pendingCount = state.deliveries.filter(d => d.status === "pending" || d.status === "disputed").length;

  const resetAlertHtml = state.resetRequests.length > 0 ? `
    <div class="card" style="background: #fef2f2; border: 1.5px solid #fca5a5;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3 style="font-size:14px; font-weight:800; color:#991b1b;">🔑 Solicitações de Recuperação de Senha (${state.resetRequests.length})</h3>
          <p class="small" style="color:#7f1d1d;">Usuários que validaram o telefone e aguardam nova senha</p>
        </div>
        <button class="danger small" id="btnVerResets">Ver Pedidos</button>
      </div>
    </div>
  ` : '';

  $("adminPanel").innerHTML = `
    ${resetAlertHtml}

    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <div>
          <h2 style="font-size: 18px; font-weight: 800; color: var(--text-title);">Visão Geral do Programa</h2>
          <p class="small">Areia Branca/RN • Clique nos quadros para ver os dados</p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="secondary small" id="btnBackupNow" title="Baixar cópia completa de segurança">💾 Backup Completo</button>
          <button class="accent small" id="btnRelatorioGeral">📊 Relatório Completo (Fotos, GPS & Períodos)</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card" id="cardFamilias"><span class="icon">🏡</span><div class="title">Famílias</div><div class="value">${state.households.length}</div></div>
        <div class="stat-card" id="cardMotoristas"><span class="icon">👤</span><div class="title">Motoristas</div><div class="value">${state.drivers.length}</div></div>
        <div class="stat-card" id="cardVeiculos"><span class="icon">🚛</span><div class="title">Veículos</div><div class="value">${state.vehicles.length}</div></div>
        
        <div class="stat-card" id="cardEntregas" style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border-color: #7dd3fc;">
          <span class="icon">🌊</span>
          <div class="title" style="color: #0369a1;">Total Entregas</div>
          <div class="value" style="color: #0c4a6e;">${state.deliveries.length}</div>
          <div style="margin-top: 6px; font-size: 10px; font-weight: 800; color: #0284c7; border-top: 1px dashed #7dd3fc; padding-top: 4px;">
            <span>📅 Prog: ${scheduledCount}</span> • 
            <span style="color:#059669;">✅ Real: ${completedCount}</span> • 
            <span style="color:#dc2626;">⏳ Pend: ${pendingCount}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Cadastros e Agendamentos</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
        <button class="primary" id="btnNewFam">🏡 Família</button>
        <button class="primary" id="btnNewMot">👤 Motorista</button>
        <button class="primary" id="btnNewVei">🚛 Veículo</button>
        <button class="accent" id="btnNewAg">🌊 Agendar</button>
      </div>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Filtrar e Pesquisar Registros</h2>

      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
        <button class="filter-tab-btn" data-cat="familias">🏡 Famílias</button>
        <button class="filter-tab-btn" data-cat="motoristas">👤 Motoristas</button>
        <button class="filter-tab-btn" data-cat="veiculos">🚛 Veículos</button>
        <button class="filter-tab-btn" data-cat="entregas">🌊 Entregas</button>
      </div>

      <div id="filterOptionsContainer" class="hidden" style="background: #f8fafc; padding: 14px; border-radius: 14px; border: 1px solid var(--border); margin-bottom: 14px;">
        <label id="searchLabel">Digite para filtrar:</label>
        <input id="searchInput" type="text" placeholder="Digite o nome, placa ou comunidade..." style="margin-bottom:0;">
      </div>

      <div id="dynamicRecords" class="records-grid">
        <p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Selecione uma categoria acima para iniciar a busca.</p>
      </div>
    </div>
  `;

  if ($("btnVerResets")) $("btnVerResets").onclick = showResetRequestsModal;
  if ($("btnBackupNow")) $("btnBackupNow").onclick = downloadFullBackupFile;

  $("cardFamilias").onclick = () => showCategoryModal("familias");
  $("cardMotoristas").onclick = () => showCategoryModal("motoristas");
  $("cardVeiculos").onclick = () => showCategoryModal("veiculos");
  $("cardEntregas").onclick = () => showCategoryModal("entregas");

  $("btnRelatorioGeral").onclick = showAdvancedReportModal;
  $("btnNewFam").onclick = () => showHouseholdForm();
  $("btnNewMot").onclick = () => showDriverForm();
  $("btnNewVei").onclick = () => showVehicleForm();
  $("btnNewAg").onclick = () => showDeliveryForm();

  document.querySelectorAll(".filter-tab-btn").forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll(".filter-tab-btn").forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      const cat = e.currentTarget.dataset.cat;
      state.filters.category = cat;
      state.filters.searchTerm = "";
      
      $("filterOptionsContainer").classList.remove("hidden");
      const sInput = $("searchInput");
      sInput.value = "";
      sInput.placeholder = cat === "familias" ? "Digite o nome da família ou comunidade..." :
                           cat === "motoristas" ? "Digite o nome do motorista..." :
                           cat === "veiculos" ? "Digite a placa ou modelo do veículo..." :
                           "Digite o nome do morador ou motorista...";
      
      renderDynamicRecords();
    };
  });

  $("searchInput").oninput = (e) => {
    state.filters.searchTerm = sanitizeText(e.target.value);
    renderDynamicRecords();
  };
}

/* =========================================================
   RELATÓRIO COMPLETO: IMPRESSÃO PDF PROFISSIONAL + EXCEL XLS FORMATADO
========================================================= */
function showAdvancedReportModal() {
  const todayStr = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  openModal(`
    <div>
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 6px;">📊 Relatório Completo e Auditoria Operacional</h2>
      <p class="small" style="margin-bottom: 12px;">Filtre por período (15 dias, mês, anual ou datas livres), motorista ou família, veja fotos/GPS e exporte.</p>

      <!-- ATALHOS RÁPIDOS DE PERÍODO -->
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
        <button type="button" class="secondary small" id="btnPreset15">📅 Últimos 15 dias</button>
        <button type="button" class="secondary small" id="btnPresetMonth">📅 Mês Atual</button>
        <button type="button" class="secondary small" id="btnPresetYear">📅 Ano Atual</button>
        <button type="button" class="secondary small" id="btnPresetAll">🌐 Todo o Período</button>
      </div>

      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:12px; display:grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap:8px;">
        <label class="small"><b>Data Inicial:</b> <input type="date" id="repStartDate" value="${thirtyDaysAgo}" style="margin-bottom:0;"></label>
        <label class="small"><b>Data Final:</b> <input type="date" id="repEndDate" value="${todayStr}" style="margin-bottom:0;"></label>
        <label class="small"><b>Motorista:</b> 
          <select id="repDriver" style="margin-bottom:0;">
            <option value="">Todos os Motoristas</option>
            ${state.drivers.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("")}
          </select>
        </label>
        <label class="small"><b>Família:</b> 
          <select id="repHousehold" style="margin-bottom:0;">
            <option value="">Todas as Famílias</option>
            ${state.households.map(h => `<option value="${esc(h.name)}">${esc(h.name)} (${esc(h.community)})</option>`).join("")}
          </select>
        </label>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
        <button class="primary small" id="btnApplyRep" style="flex:1;">🔍 Filtrar</button>
        <button class="accent small" id="btnExportPDF" style="flex:1;">🖨️ Imprimir / PDF Oficial</button>
        <button class="secondary small" id="btnExportExcel" style="flex:1;">📊 Exportar Excel (.xls)</button>
      </div>

      <div id="repSummaryBar" style="background:#e0f2fe; border:1px solid #7dd3fc; padding:8px 12px; border-radius:10px; margin-bottom:12px; font-size:12px; font-weight:700; color:#0c4a6e;"></div>

      <div id="reportResultContainer" style="max-height: 45vh; overflow-y: auto;"></div>
    </div>
  `);

  const setPresetDates = (daysBack, mode = "days") => {
    const now = new Date();
    $("repEndDate").value = now.toISOString().split("T")[0];
    if (mode === "all") {
      $("repStartDate").value = "";
      $("repEndDate").value = "";
    } else if (mode === "month") {
      $("repStartDate").value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    } else if (mode === "year") {
      $("repStartDate").value = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0];
    } else {
      $("repStartDate").value = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    }
    runFilter();
  };

  $("btnPreset15").onclick = () => setPresetDates(15);
  $("btnPresetMonth").onclick = () => setPresetDates(0, "month");
  $("btnPresetYear").onclick = () => setPresetDates(0, "year");
  $("btnPresetAll").onclick = () => setPresetDates(0, "all");

  const runFilter = () => {
    const start = $("repStartDate").value;
    const end = $("repEndDate").value;
    const selDriver = $("repDriver").value;
    const selHousehold = $("repHousehold").value;

    const filtered = state.deliveries.filter(d => {
      const dDate = d.scheduledDate || "";
      if (start && dDate < start) return false;
      if (end && dDate > end) return false;
      if (selDriver && d.driverName !== selDriver) return false;
      if (selHousehold && d.recipientName !== selHousehold) return false;
      return true;
    });

    state.filteredReportData = filtered;

    const totalLitros = filtered.reduce((acc, cur) => acc + (Number(cur.plannedLiters) || 0), 0);
    const totalRealizadas = filtered.filter(d => d.status === "completed").length;
    const totalAusencias = filtered.filter(d => d.status === "pending" || d.status === "disputed").length;

    $("repSummaryBar").innerHTML = `Registros: ${filtered.length} | Realizadas: ${totalRealizadas} | Pendentes/Ausências: ${totalAusencias} | Volume Total: ${totalLitros.toLocaleString("pt-BR")} L`;

    const container = $("reportResultContainer");
    container.innerHTML = "";

    if (filtered.length === 0) {
      container.innerHTML = `<p class="small" style="text-align:center; padding:20px;">Nenhuma entrega encontrada para este período/filtros.</p>`;
      return;
    }

    container.innerHTML = filtered.map(d => {
      const st = translateStatus(d.status);
      return `
        <div style="background:#fff; border:1px solid var(--border); border-radius:12px; padding:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between;">
            <b style="color:var(--text-title);">${esc(d.recipientName)}</b>
            <span class="pill ${st.class}">${st.text}</span>
          </div>
          <p class="small" style="margin-top:4px;"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Comunidade:</b> ${esc(d.community || '—')}</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')} · <b>Volume:</b> ${d.plannedLiters} L</p>
          
          ${d.lat && d.lng ? `<p class="small" style="color:var(--success); font-weight:700; margin-top:4px;">📍 GPS: <a href="https://maps.google.com/?q=${d.lat},${d.lng}" target="_blank" style="color:var(--success);">Lat ${d.lat.toFixed(5)}, Lng ${d.lng.toFixed(5)} (Ver no Mapa)</a></p>` : '<p class="small" style="color:var(--danger); font-weight:700;">📍 GPS: Não registrado</p>'}
          
          ${d.note ? `<p class="small" style="color:var(--danger); font-weight:700; margin-top:2px;">⚠️ Ocorrência / Obs: ${esc(d.note)}</p>` : ''}
          ${d.disputeReason ? `<p class="small" style="color:var(--danger); font-weight:700; margin-top:2px;">❌ Contestação: ${esc(d.disputeReason)}</p>` : ''}
          ${d.photoUrl ? `
            <div style="margin-top:8px;">
              <img src="${d.photoUrl}" alt="Foto da ocorrência" style="max-width:160px; max-height:110px; border-radius:8px; border:1px solid #cbd5e1; display:block; margin-bottom:4px;">
              <a href="${d.photoUrl}" download="foto_${d.id}.jpg" class="secondary small" style="text-decoration:none; display:inline-block;">📷 Baixar Foto em Alta</a>
            </div>` : ''}
        </div>
      `;
    }).join("");
  };

  $("btnApplyRep").onclick = runFilter;
  runFilter();

  /* IMPRESSÃO / PDF OFICIAL LIMPO EM FOLHA A4 */
  $("btnExportPDF").onclick = () => {
    const rows = state.filteredReportData;
    const start = $("repStartDate").value ? dateOnly($("repStartDate").value) : "Início";
    const end = $("repEndDate").value ? dateOnly($("repEndDate").value) : "Hoje";
    const driverFilter = $("repDriver").value || "Todos";
    const familyFilter = $("repHousehold").value || "Todas";
    const totalLitros = rows.reduce((acc, cur) => acc + (Number(cur.plannedLiters) || 0), 0);

    const printWin = window.open("", "_blank", "width=1000,height=750");
    printWin.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Relatório Oficial - Água para Todos</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 20px; font-size: 12px; }
          .header { border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
          .header h1 { margin: 0; font-size: 18px; color: #0c4a6e; }
          .header p { margin: 2px 0 0; color: #475569; font-size: 11px; }
          .meta { background: #f1f5f9; padding: 10px; border-radius: 6px; margin-bottom: 14px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th { background: #0c4a6e; color: #ffffff; text-align: left; padding: 8px; font-size: 11px; border: 1px solid #0c4a6e; }
          td { padding: 7px 8px; border: 1px solid #cbd5e1; vertical-align: top; font-size: 11px; }
          tr:nth-child(even) { background: #f8fafc; }
          .badge { padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 10px; }
          .st-completed { background: #dcfce7; color: #166534; }
          .st-pending { background: #fef3c7; color: #92400e; }
          .st-disputed { background: #fee2e2; color: #991b1b; }
          .st-scheduled { background: #e0f2fe; color: #075985; }
          .thumb { max-width: 90px; max-height: 70px; border-radius: 4px; border: 1px solid #94a3b8; }
          .footer { text-align: right; font-size: 10px; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 8px; }
          @media print { @page { size: A4 landscape; margin: 12mm; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>RELATÓRIO DE AUDITORIA E ABASTECIMENTO — ÁGUA PARA TODOS</h1>
            <p>Município de Areia Branca/RN • Controle Logístico e Transparência</p>
          </div>
          <div style="text-align:right;">
            <strong>Emissão:</strong> ${new Date().toLocaleString("pt-BR")}
          </div>
        </div>

        <div class="meta">
          <div><strong>Período:</strong> ${start} até ${end}</div>
          <div><strong>Motorista:</strong> ${esc(driverFilter)}</div>
          <div><strong>Família:</strong> ${esc(familyFilter)}</div>
          <div><strong>Total Entregas:</strong> ${rows.length}</div>
          <div><strong>Volume Total:</strong> ${totalLitros.toLocaleString("pt-BR")} Litros</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Família Beneficiária</th>
              <th>Comunidade</th>
              <th>Motorista / Placa</th>
              <th>Volume</th>
              <th>Status</th>
              <th>Localização GPS</th>
              <th>Observações / Foto</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(d => {
              const st = translateStatus(d.status);
              return `
                <tr>
                  <td>${dateOnly(d.scheduledDate)}</td>
                  <td><strong>${esc(d.recipientName)}</strong></td>
                  <td>${esc(d.community || "—")}</td>
                  <td>${esc(d.driverName || "—")}<br><small>${esc(d.vehiclePlate || "")}</small></td>
                  <td>${(Number(d.plannedLiters) || 0).toLocaleString("pt-BR")} L</td>
                  <td><span class="badge st-${d.status}">${st.text}</span></td>
                  <td>${d.lat && d.lng ? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : "Não registrado"}</td>
                  <td>
                    ${d.note ? `<div>Obs: ${esc(d.note)}</div>` : ""}
                    ${d.disputeReason ? `<div style="color:#b91c1c;">Contestação: ${esc(d.disputeReason)}</div>` : ""}
                    ${d.photoUrl ? `<img src="${d.photoUrl}" class="thumb">` : "—"}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

        <div class="footer">
          Documento gerado eletronicamente pelo Sistema Água para Todos • Areia Branca/RN
        </div>
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  };

  /* EXPORTAÇÃO EXCEL (.XLS) COM TABELA ESTRUTURADA, ESTILOS, FILTROS E LARGURA DE COLUNAS */
  $("btnExportExcel").onclick = () => {
    const rows = state.filteredReportData;
    const totalLitros = rows.reduce((acc, cur) => acc + (Number(cur.plannedLiters) || 0), 0);
    const todayStr = new Date().toISOString().split("T")[0];

    const excelHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Relatorio Entregas</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
          .title { font-size: 14pt; font-weight: bold; background-color: #0c4a6e; color: #ffffff; height: 32px; }
          .subtitle { font-size: 10pt; background-color: #e0f2fe; color: #0c4a6e; font-weight: bold; }
          th { background-color: #0284c7; color: #ffffff; font-weight: bold; border: 1px solid #000000; padding: 8px; text-align: left; }
          td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: middle; }
          .num { text-align: right; }
          .st-completed { background-color: #dcfce7; color: #166534; font-weight: bold; }
          .st-pending { background-color: #fef3c7; color: #92400e; font-weight: bold; }
          .st-disputed { background-color: #fee2e2; color: #991b1b; font-weight: bold; }
          .st-scheduled { background-color: #f1f5f9; color: #334155; }
          .total-row { background-color: #f8fafc; font-weight: bold; border-top: 2px solid #0c4a6e; }
        </style>
      </head>
      <body>
        <table>
          <tr>
            <td colspan="10" class="title">RELATÓRIO DE ABASTECIMENTO — PROGRAMA ÁGUA PARA TODOS (AREIA BRANCA/RN)</td>
          </tr>
          <tr>
            <td colspan="10" class="subtitle">Gerado em: ${new Date().toLocaleString("pt-BR")} | Total de Registros: ${rows.length} | Volume Total: ${totalLitros.toLocaleString("pt-BR")} Litros</td>
          </tr>
          <tr><td colspan="10"></td></tr>
          <tr x:autofilter="all">
            <th style="width:95px;">Data</th>
            <th style="width:220px;">Família Beneficiária</th>
            <th style="width:160px;">Comunidade</th>
            <th style="width:180px;">Motorista</th>
            <th style="width:100px;">Veículo</th>
            <th style="width:110px;">Volume (Litros)</th>
            <th style="width:130px;">Status</th>
            <th style="width:110px;">Latitude</th>
            <th style="width:110px;">Longitude</th>
            <th style="width:250px;">Observações / Foto Anexada</th>
          </tr>
          ${rows.map(d => {
            const st = translateStatus(d.status);
            const obsText = [
              d.note ? `Obs: ${d.note}` : "",
              d.disputeReason ? `Contestação: ${d.disputeReason}` : "",
              d.photoUrl ? "[Foto Registrada no Sistema]" : ""
            ].filter(Boolean).join(" | ");
            return `
              <tr>
                <td>${dateOnly(d.scheduledDate)}</td>
                <td>${esc(d.recipientName || "")}</td>
                <td>${esc(d.community || "")}</td>
                <td>${esc(d.driverName || "")}</td>
                <td>${esc(d.vehiclePlate || "")}</td>
                <td class="num">${Number(d.plannedLiters) || 0}</td>
                <td class="st-${d.status}">${st.text}</td>
                <td>${d.lat || ""}</td>
                <td>${d.lng || ""}</td>
                <td>${esc(obsText)}</td>
              </tr>
            `;
          }).join("")}
          <tr class="total-row">
            <td colspan="5">TOTAL GERAL DO PERÍODO FILTRADO</td>
            <td class="num">${totalLitros}</td>
            <td colspan="4">${rows.length} entregas listadas</td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(["\uFEFF" + excelHtml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Relatorio_Agua_Para_Todos_${todayStr}.xls`;
    a.click();
    toast("📊 Planilha Excel (.xls) formatada e com filtros exportada!");
  };
}

function showResetRequestsModal() {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 14px;">🔑 Solicitações de Redefinição de Senha</h2>
    <div style="max-height: 65vh; overflow-y: auto;">
      ${state.resetRequests.map(r => `
        <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
          <b style="color:var(--text-title);">${esc(r.userName)}</b>
          <span class="pill scheduled">${r.role === 'driver' ? 'Motorista' : 'Família'}</span>
          <p class="small" style="margin-top:4px;"><b>Telefone:</b> ${esc(r.phone)}</p>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <a href="https://wa.me/55${normalizePhone(r.phone)}?text=${encodeURIComponent(`Olá ${r.userName}, recebemos sua solicitação de recuperação de senha no sistema Água para Todos.`)}" target="_blank" class="primary small" style="text-decoration:none; flex:1; text-align:center;">💬 Responder no WhatsApp</a>
            <button class="secondary small" data-resolve-reset="${r.id}">✅ Concluir</button>
          </div>
        </div>
      `).join("") || "<p class='small'>Nenhuma solicitação pendente.</p>"}
    </div>
  `);

  document.querySelectorAll("[data-resolve-reset]").forEach(btn => {
    btn.onclick = async e => {
      const id = e.currentTarget.dataset.resolveReset;
      await updateDoc(doc(db, "password_resets", id), { status: "resolved", resolvedAt: serverTimestamp() });
      toast("Solicitação marcada como concluída!");
      closeModal();
      renderAdmin();
    };
  });
}

function renderDynamicRecords() {
  const container = $("dynamicRecords");
  if (!container) return;
  container.innerHTML = "";

  const { category, searchTerm } = state.filters;
  if (!category) return;

  let count = 0;

  if (category === "familias") {
    state.households
      .filter(h => !searchTerm || sanitizeText(h.name).includes(searchTerm) || sanitizeText(h.community).includes(searchTerm))
      .forEach(h => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">🏡 ${esc(h.name)}</div><span class="pill completed">Ativa</span></div>
          <p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
          <p class="small"><b>Endereço:</b> ${esc(h.address || '—')}</p>
          <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} L</p>
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-fam="${h.id}">✏️ Alterar</button>
            <button class="danger small" data-del-fam="${h.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-fam]").onclick = () => showHouseholdForm(h.id, h);
        el.querySelector("[data-del-fam]").onclick = () => {
          confirmSecureDelete(`a família ${h.name}`, async () => {
            await deleteDoc(doc(db, "households", h.id));
            toast("Família excluída!");
            renderAdmin();
          });
        };
        container.appendChild(el);
      });
  } else if (category === "motoristas") {
    state.drivers
      .filter(d => !searchTerm || sanitizeText(d.name).includes(searchTerm))
      .forEach(m => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = "#bae6fd";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">👤 ${esc(m.name)}</div><span class="pill scheduled">Ativo</span></div>
          <p class="small"><b>Telefone:</b> ${esc(m.phone || '—')}</p>
          <p class="small"><b>Veículo:</b> ${esc(m.vehiclePlate || 'Nenhum')}</p>
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-mot="${m.id}">✏️ Alterar</button>
            <button class="danger small" data-del-mot="${m.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-mot]").onclick = () => showDriverForm(m.id, m);
        el.querySelector("[data-del-mot]").onclick = () => {
          confirmSecureDelete(`o motorista ${m.name}`, async () => {
            await deleteDoc(doc(db, "users", m.id));
            toast("Motorista excluído!");
            renderAdmin();
          });
        };
        container.appendChild(el);
      });
  } else if (category === "veiculos") {
    state.vehicles
      .filter(v => !searchTerm || sanitizeText(v.plate).includes(searchTerm) || sanitizeText(v.model).includes(searchTerm))
      .forEach(v => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = "#cbd5e1";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">🚛 ${esc(v.plate)}</div><span class="pill scheduled">${v.capacity || 15000} L</span></div>
          <p class="small"><b>Modelo:</b> ${esc(v.model)}</p>
          <p class="small"><b>Motorista:</b> ${esc(v.driverName || 'Nenhum')}</p>
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-vei="${v.id}">✏️ Alterar</button>
            <button class="danger small" data-del-vei="${v.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-vei]").onclick = () => showVehicleForm(v.id, v);
        el.querySelector("[data-del-vei]").onclick = () => {
          confirmSecureDelete(`o veículo ${v.plate}`, async () => {
            await deleteDoc(doc(db, "vehicles", v.id));
            toast("Veículo excluído!");
            renderAdmin();
          });
        };
        container.appendChild(el);
      });
  } else if (category === "entregas") {
    state.deliveries
      .filter(d => !searchTerm || sanitizeText(d.recipientName).includes(searchTerm) || sanitizeText(d.driverName).includes(searchTerm))
      .forEach(d => {
        count++;
        const st = translateStatus(d.status);

        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = d.status === "completed" ? "#a7f3d0" : d.status === "disputed" ? "#fca5a5" : "#fef08a";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">🌊 ${esc(d.recipientName)}</div><span class="pill ${st.class}">${st.text}</span></div>
          <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
          ${d.pin ? `<p class="small" style="color:var(--primary); font-weight:700; margin-top:2px;">PIN: ${d.pin}</p>` : ''}
          ${d.disputeReason ? `<p class="small" style="color:var(--danger); font-weight:700;">❌ Contestação: ${esc(d.disputeReason)}</p>` : ''}
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-del="${d.id}">✏️ Alterar</button>
            <button class="danger small" data-del-del="${d.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-del]").onclick = () => showDeliveryForm(d.id, d);
        el.querySelector("[data-del-del]").onclick = () => {
          confirmSecureDelete(`a entrega para ${d.recipientName}`, async () => {
            await deleteDoc(doc(db, "deliveries", d.id));
            toast("Entrega excluída!");
            renderAdmin();
          });
        };
        container.appendChild(el);
      });
  }

  if (count === 0) {
    container.innerHTML = `<p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Nenhum registro encontrado para esta busca.</p>`;
  }
}

function showCategoryModal(type) {
  let title = "", html = "";

  if (type === "familias") {
    title = "🏡 Famílias Cadastradas";
    html = state.households.map(h => `
      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
        <b style="color:var(--text-title);">${esc(h.name)}</b>
        <p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
        <p class="small"><b>Endereço:</b> ${esc(h.address || '—')}</p>
        <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} L</p>
      </div>
    `).join("") || "<p class='small'>Nenhuma família cadastrada.</p>";
  } else if (type === "motoristas") {
    title = "👤 Motoristas Cadastrados";
    html = state.drivers.map(m => `
      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
        <b style="color:var(--text-title);">${esc(m.name)}</b>
        <p class="small"><b>Telefone/WhatsApp:</b> ${esc(m.phone)}</p>
        <p class="small"><b>Veículo Vinculado:</b> ${esc(m.vehiclePlate || 'Nenhum')}</p>
      </div>
    `).join("") || "<p class='small'>Nenhum motorista cadastrado.</p>";
  } else if (type === "veiculos") {
    title = "🚛 Veículos Cadastrados";
    html = state.vehicles.map(v => `
      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
        <b style="color:var(--text-title);">${esc(v.plate)}</b>
        <p class="small"><b>Modelo:</b> ${esc(v.model)} · <b>Capacidade:</b> ${v.capacity} L</p>
        <p class="small"><b>Motorista:</b> ${esc(v.driverName || 'Nenhum')}</p>
      </div>
    `).join("") || "<p class='small'>Nenhum veículo cadastrado.</p>";
  } else if (type === "entregas") {
    title = "🌊 Lista Geral de Entregas";
    html = state.deliveries.map(d => {
      const st = translateStatus(d.status);
      return `
        <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
          <b style="color:var(--text-title);">${esc(d.recipientName)}</b>
          <span class="pill ${st.class}">${st.text}</span>
          <p class="small" style="margin-top:4px;"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
        </div>
      `;
    }).join("") || "<p class='small'>Nenhuma entrega cadastrada.</p>";
  }

  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">${title}</h2>
    <div style="max-height: 65vh; overflow-y: auto;">${html}</div>
  `);
}

function showHouseholdForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🏡 ${editId ? 'Editar' : 'Cadastrar'} Família</h2>
    <form id="hForm">
      <label>Nome do Responsável <input id="hName" value="${data?.name || ''}" required></label>
      <div id="hNameSuggestions" class="live-suggestions-box hidden"></div>

      <label>Telefone / WhatsApp (Login) <input id="hPhone" type="tel" value="${data?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha ${editId ? '(6 dígitos para criar/alterar acesso)' : 'Inicial (6 dígitos)'} <input id="hPassword" type="password" maxlength="6" placeholder="123456" ${editId ? '' : 'required'}></label>
      <label>Comunidade <input id="hComm" value="${data?.community || ''}" required></label>
      <label>Endereço / Ponto de Referência <input id="hAddr" value="${data?.address || ''}" required></label>
      <label>Volume Cisterna (Litros) <input id="hLit" type="number" value="${data?.defaultLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canH" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar'}</button>
      </div>
    </form>
  `);

  attachUppercaseNoAccent($("hName"));
  attachUppercaseNoAccent($("hComm"));
  attachUppercaseNoAccent($("hAddr"));
  applyPhoneMask($("hPhone"));

  $("hName").oninput = (e) => {
    attachUppercaseNoAccent(e.target);
    const val = e.target.value.trim();
    const box = $("hNameSuggestions");
    if (val.length > 0) {
      const matches = state.households.filter(h => h.name.startsWith(val));
      if (matches.length > 0) {
        box.classList.remove("hidden");
        box.innerHTML = matches.map(m => `<div class="live-suggestion-item">🏡 ${esc(m.name)} (${esc(m.community)})</div>`).join("");
      } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };

  $("canH").onclick = closeModal;

  $("hForm").onsubmit = async e => {
    e.preventDefault();
    const phone = $("hPhone").value.trim();
    const cleanPhone = normalizePhone(phone);
    const pass = $("hPassword").value.trim();

    if (pass && (pass.length !== 6 || !/^\d+$/.test(pass))) {
      return alert("A senha deve conter exatamente 6 números.");
    }

    const exists = state.households.some(h => normalizePhone(h.phone) === cleanPhone && h.id !== editId);
    if (exists) return alert("Já existe uma família cadastrada com este telefone!");

    const payload = {
      name: $("hName").value.trim(),
      phone,
      community: $("hComm").value.trim(),
      address: $("hAddr").value.trim(),
      defaultLiters: Number($("hLit").value)
    };

    try {
      const authEmail = phoneAuthEmail(phone);
      if (editId) {
        await updateDoc(doc(db, "households", editId), payload);
        if (pass) {
          try {
            const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass);
            await signOutSecondary(secondaryAuth);
            await setDoc(doc(db, "users", cred.user.uid), { name: payload.name, phone, authEmail, role: "recipient", active: true, householdId: editId }, { merge: true });
          } catch (e) {}
        }
        toast("Família atualizada!");
      } else {
        let uid = null;
        try {
          const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass);
          uid = cred.user.uid;
          await signOutSecondary(secondaryAuth);
        } catch(authErr) {
          uid = "rec_" + Date.now();
        }
        const ref = await addDoc(collection(db, "households"), { ...payload, recipientUid: uid, active: true, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", uid), { name: payload.name, phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp() });
        toast("Família cadastrada com sucesso!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro ao salvar: " + err.message); }
  };
}

function showDriverForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">👤 ${editId ? 'Editar' : 'Cadastrar'} Motorista</h2>
    <form id="mForm">
      <label>Nome Completo <input id="mName" value="${data?.name || ''}" required></label>
      <div id="mNameSuggestions" class="live-suggestions-box hidden"></div>

      <label>Telefone / WhatsApp (Login) <input id="mPhone" type="tel" value="${data?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha ${editId ? '(6 dígitos)' : 'Inicial (6 dígitos)'} <input id="mPass" type="password" maxlength="6" placeholder="123456" ${editId ? '' : 'required'}></label>
      <label>Vincular Veículo (Placa) 
        <select id="mVei">
          <option value="">Nenhum veículo vinculado</option>
          ${state.vehicles.map(v => `<option value="${esc(v.plate)}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${esc(v.plate)} - ${esc(v.model)}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canM" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Salvar Motorista'}</button>
      </div>
    </form>
  `);

  attachUppercaseNoAccent($("mName"));
  applyPhoneMask($("mPhone"));

  $("mName").oninput = (e) => {
    attachUppercaseNoAccent(e.target);
    const val = e.target.value.trim();
    const box = $("mNameSuggestions");
    if (val.length > 0) {
      const matches = state.drivers.filter(d => d.name.startsWith(val));
      if (matches.length > 0) {
        box.classList.remove("hidden");
        box.innerHTML = matches.map(m => `<div class="live-suggestion-item">👤 ${esc(m.name)}</div>`).join("");
      } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };

  $("canM").onclick = closeModal;

  $("mForm").onsubmit = async e => {
    e.preventDefault();
    const phone = $("mPhone").value.trim();
    const cleanPhone = normalizePhone(phone);
    const pass = $("mPass").value.trim();

    if (pass && (pass.length !== 6 || !/^\d+$/.test(pass))) {
      return alert("A senha deve conter exatamente 6 números.");
    }

    const exists = state.drivers.some(d => normalizePhone(d.phone) === cleanPhone && d.id !== editId);
    if (exists) return alert("Já existe um motorista cadastrado com este telefone!");

    const payload = {
      name: $("mName").value.trim(),
      phone,
      vehiclePlate: $("mVei").value || ""
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "users", editId), payload);
        toast("Motorista atualizado!");
      } else {
        const authEmail = phoneAuthEmail(phone);
        let uid = null;
        try {
          const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass);
          uid = cred.user.uid;
          await signOutSecondary(secondaryAuth);
        } catch(authErr) {
          uid = "drv_" + Date.now();
        }
        await setDoc(doc(db, "users", uid), { ...payload, authEmail, role: "driver", active: true, createdAt: serverTimestamp() });
        toast("Motorista cadastrado!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro ao salvar: " + err.message); }
  };
}

function showVehicleForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🚛 ${editId ? 'Editar' : 'Cadastrar'} Veículo</h2>
    <form id="vForm">
      <label>Placa do Veículo <input id="vPlate" value="${data?.plate || ''}" placeholder="ABC-1234" required></label>
      <div id="vPlateSuggestions" class="live-suggestions-box hidden"></div>

      <label>Modelo / Descrição <input id="vModel" value="${data?.model || ''}" placeholder="MERCEDES 15.000L" required></label>
      <label>Capacidade (Litros) <input id="vCap" type="number" value="${data?.capacity || 15000}" required></label>
      <label>Vincular Motorista 
        <select id="vMot">
          <option value="">Nenhum motorista vinculado</option>
          ${state.drivers.map(m => `<option value="${esc(m.name)}" ${data?.driverName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canV" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar Veículo'}</button>
      </div>
    </form>
  `);

  applyPlateMask($("vPlate"));
  attachUppercaseNoAccent($("vModel"));

  $("vPlate").oninput = (e) => {
    applyPlateMask(e.target);
    const val = e.target.value.trim();
    const box = $("vPlateSuggestions");
    if (val.length > 0) {
      const matches = state.vehicles.filter(v => v.plate.startsWith(val));
      if (matches.length > 0) {
        box.classList.remove("hidden");
        box.innerHTML = matches.map(m => `<div class="live-suggestion-item">🚛 ${esc(m.plate)} - ${esc(m.model)}</div>`).join("");
      } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };

  $("canV").onclick = closeModal;

  $("vForm").onsubmit = async e => {
    e.preventDefault();
    const plate = $("vPlate").value.trim().toUpperCase();

    const exists = state.vehicles.some(v => v.plate === plate && v.id !== editId);
    if (exists) return alert("Já existe um veículo cadastrado com esta placa!");

    const payload = {
      plate,
      model: $("vModel").value.trim(),
      capacity: Number($("vCap").value),
      driverName: $("vMot").value || ""
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "vehicles", editId), payload);
        toast("Veículo atualizado!");
      } else {
        await addDoc(collection(db, "vehicles"), { ...payload, createdAt: serverTimestamp() });
        toast("Veículo cadastrado!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro ao salvar: " + err.message); }
  };
}

function showDeliveryForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🌊 ${editId ? 'Editar' : 'Programar'} Entrega</h2>
    <form id="dForm">
      <label>Família <select id="sFam" required><option value="">Selecione...</option>${state.households.map(h => `<option value="${h.id}" ${data?.householdId === h.id ? 'selected' : ''}>${esc(h.name)} - ${esc(h.community)}</option>`).join("")}</select></label>
      <label>Motorista <select id="sMot" required><option value="">Selecione...</option>${state.drivers.map(m => `<option value="${esc(m.name)}" ${data?.driverName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join("")}</select></label>
      <label>Veículo <select id="sVei" required><option value="">Selecione...</option>${state.vehicles.map(v => `<option value="${esc(v.plate)}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${esc(v.plate)}</option>`).join("")}</select></label>
      <label>Data Prevista <input id="sDate" type="date" value="${data?.scheduledDate || ''}" required></label>
      <label>Volume (Litros) <input id="sLit" type="number" value="${data?.plannedLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canD" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar Alterações' : 'Confirmar Agendamento'}</button>
      </div>
    </form>
  `);
  $("canD").onclick = closeModal;

  $("sFam").onchange = e => {
    if (!editId) {
      const f = state.households.find(h => h.id === e.target.value);
      if (f && f.defaultLiters) $("sLit").value = f.defaultLiters;
    }
  };

  $("dForm").onsubmit = async e => {
    e.preventDefault();
    const f = state.households.find(h => h.id === $("sFam").value);
    const payload = {
      householdId: f.id, 
      recipientName: f.name, 
      community: f.community, 
      address: f.address,
      driverName: $("sMot").value,
      vehiclePlate: $("sVei").value,
      scheduledDate: $("sDate").value, 
      plannedLiters: Number($("sLit").value),
      status: "scheduled"
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "deliveries", editId), payload);
        toast("Entrega atualizada!");
      } else {
        await addDoc(collection(db, "deliveries"), { ...payload, createdAt: serverTimestamp() });
        toast("Entrega agendada!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

/* =========================================================
   PAINEL DO MOTORISTA
========================================================= */
async function renderDriver() {
  $("driverPanel").innerHTML = `
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">👤 Minhas Entregas e Operações</h2>
      <div id="dList" class="records-grid"></div>
    </div>
  `;

  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("driverName", "==", state.profile.name)));
    const deliveries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const container = $("dList");
    container.innerHTML = "";

    deliveries.forEach(item => {
      const st = translateStatus(item.status);
      const isConcluded = item.status === 'completed' || item.status === 'pending' || item.status === 'disputed';

      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = item.status === "completed" ? "#a7f3d0" : item.status === "pending" ? "#fbcfe8" : "#bae6fd";

      el.innerHTML = `
        <div class="record-header"><div class="record-title">🌊 ${esc(item.recipientName)}</div><span class="pill ${st.class}">${st.text}</span></div>
        <p class="small"><b>Data:</b> ${dateOnly(item.scheduledDate)} · <b>Comunidade:</b> ${esc(item.community)}</p>
        <p class="small"><b>Endereço:</b> ${esc(item.address || '—')}</p>

        ${!isConcluded ? `
          <div style="margin-top: 12px; background: #f8fafc; padding: 10px; border-radius: 10px; border: 1px solid var(--border);">
            <label style="font-size: 11px; margin-bottom: 4px;">Volume de Água (Litros)</label>
            <input type="number" id="volInput_${item.id}" value="${item.plannedLiters}" style="margin-bottom: 8px;">
            <div id="justDiv_${item.id}" class="hidden">
              <label style="font-size: 11px; margin-bottom: 4px; color: var(--danger);">Justificativa da Alteração</label>
              <input type="text" id="justInput_${item.id}" placeholder="Motivo da alteração de volume..." style="margin-bottom: 8px;">
            </div>
            <button class="secondary small" style="width:100%; margin-bottom:6px;" id="saveVol_${item.id}">💾 Atualizar Volume / Justificativa</button>
          </div>

          <div style="margin-top: 12px; background: #f1f5f9; padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
            <label style="font-size: 11px; margin-bottom: 4px;">PIN do Morador</label>
            <input type="text" maxlength="4" placeholder="4 dígitos" id="pinInput_${item.id}" style="margin-bottom: 8px; text-align: center; font-size: 18px; font-weight: 800; letter-spacing: 4px;">
            <button class="primary small" style="width: 100%; margin-bottom: 6px;" id="confPin_${item.id}">✅ Confirmar Entrega (PIN + GPS)</button>
            <button class="danger small" style="width: 100%;" id="ausenteBtn_${item.id}">⚠️ Morador Ausente (Ausência + Câmera)</button>
          </div>
        ` : `
          <div style="margin-top:12px; background:#f1f5f9; border:1px solid var(--border); padding:10px; border-radius:10px; text-align:center;">
            <p class="small" style="color:var(--text-title); font-weight:800;">🔒 Processo Concluído (${st.text})</p>
            <p class="small" style="margin-top:2px;">Volume registrado: <b>${item.plannedLiters} L</b></p>
            ${item.note ? `<p class="small" style="color:var(--danger); margin-top:2px;"><b>Obs:</b> ${esc(item.note)}</p>` : ''}
          </div>
        `}
      `;

      if (!isConcluded) {
        const volInput = el.querySelector(`#volInput_${item.id}`);
        const justDiv = el.querySelector(`#justDiv_${item.id}`);
        volInput.oninput = () => {
          if (Number(volInput.value) !== Number(item.plannedLiters)) {
            justDiv.classList.remove("hidden");
          } else {
            justDiv.classList.add("hidden");
          }
        };

        el.querySelector(`#saveVol_${item.id}`).onclick = async () => {
          const newVol = Number(volInput.value);
          let alterReason = item.alterReason || "";
          if (newVol !== Number(item.plannedLiters)) {
            const just = el.querySelector(`#justInput_${item.id}`).value.trim();
            if (!just) return alert("Você alterou o volume. É obrigatório informar o motivo da alteração.");
            alterReason = just;
          }
          await updateDoc(doc(db, "deliveries", item.id), { plannedLiters: newVol, alterReason });
          toast("Volume atualizado!");
          renderDriver();
        };

        el.querySelector(`#confPin_${item.id}`).onclick = () => confirmDeliveryWithPin(item.id, item.pin);
        el.querySelector(`#ausenteBtn_${item.id}`).onclick = () => showAbsentModal(item.id);
      }

      container.appendChild(el);
    });

    if (deliveries.length === 0) container.innerHTML = `<p class="small">Nenhuma entrega atribuída a você.</p>`;
  } catch(e){}
}

async function confirmDeliveryWithPin(deliveryId, expectedPin) {
  const enteredPin = $(`pinInput_${deliveryId}`).value.trim();
  if (expectedPin && enteredPin !== String(expectedPin)) {
    return alert("PIN incorreto! Solicite o código correto de 4 dígitos ao morador.");
  }

  if (!navigator.geolocation) {
    return alert("Geolocalização não suportada pelo navegador.");
  }

  toast("Capturando localização GPS...");

  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    try {
      await updateDoc(doc(db, "deliveries", deliveryId), {
        status: "completed",
        lat,
        lng,
        completedAt: serverTimestamp()
      });
      toast("Entrega confirmada com sucesso!");
      renderDriver();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    }
  }, () => {
    alert("Não foi possível obter a localização GPS. Ative o GPS do aparelho.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function showAbsentModal(deliveryId) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">⚠️ Registro de Morador Ausente</h2>
    <form id="absentForm">
      <label>Observação da Ocorrência <textarea id="obsText" rows="3" placeholder="Ex: Casa fechada, morador viajou..." required></textarea></label>
      
      <label>Foto do Local (Obrigatório Direto da Câmera) 
        <input id="obsPhoto" type="file" accept="image/*" capture="environment" required>
      </label>
      <p class="small" style="color:var(--danger); margin-bottom:14px;">Nota: Use a câmera do aparelho para tirar a foto no local.</p>

      <button type="submit" class="primary full-width" style="width:100%;">📤 Registrar Ausência com GPS e Foto</button>
    </form>
  `);

  $("absentForm").onsubmit = async e => {
    e.preventDefault();
    const note = $("obsText").value.trim() || "Morador ausente";
    const fileInput = $("obsPhoto");
    
    if (!navigator.geolocation) {
      return alert("Geolocalização obrigatória não suportada.");
    }

    toast("Processando e comprimindo foto...");

    const file = fileInput.files[0];
    if (!file) {
      return alert("Por favor, tire ou selecione a foto do local.");
    }

    const reader = new FileReader();
    reader.onload = function(uploadEvent) {
      const img = new Image();
      img.onload = async function() {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 700;
        const MAX_HEIGHT = 700;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const compressedPhotoUrl = canvas.toDataURL('image/jpeg', 0.65);

        toast("Capturando GPS...");
        navigator.geolocation.getCurrentPosition(async pos => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const pin = Math.floor(1000 + Math.random() * 9000);

          try {
            await updateDoc(doc(db, "deliveries", deliveryId), {
              status: "pending",
              pin,
              lat,
              lng,
              note,
              photoUrl: compressedPhotoUrl,
              updatedAt: serverTimestamp()
            });
            closeModal();
            toast("Ausência registrada com sucesso!");
            renderDriver();
          } catch (err) {
            alert("Erro ao salvar no banco: " + err.message);
          }
        }, () => {
          alert("Erro ao capturar GPS. Verifique se o GPS está ativado.");
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
      };
      img.src = uploadEvent.target.result;
    };
    reader.readAsDataURL(file);
  };
}

/* =========================================================
   PAINEL DA FAMÍLIA / BENEFICIÁRIO
========================================================= */
async function renderRecipient() {
  const userPhone = normalizePhone(state.profile.phone);
  
  let household = state.households.find(h => h.id === state.profile.householdId || normalizePhone(h.phone) === userPhone);
  
  if (!household) {
    try {
      const snapH = await getDocs(query(collection(db, "households"), where("phone", "==", state.profile.phone)));
      if (!snapH.empty) {
        household = { id: snapH.docs[0].id, ...snapH.docs[0].data() };
      } else {
        const allH = await getDocs(collection(db, "households"));
        const found = allH.docs.find(d => normalizePhone(d.data().phone) === userPhone);
        if (found) {
          household = { id: found.id, ...found.data() };
        }
      }
    } catch (e) {}
  }

  household = household || {};

  $("recipientPanel").innerHTML = `
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 12px;">🏡 Cadastro da Família</h2>
      <p class="small"><b>Responsável:</b> ${esc(state.profile.name || household.name || '—')}</p>
      <p class="small"><b>Telefone/WhatsApp:</b> ${esc(state.profile.phone || household.phone || '—')}</p>
      <p class="small"><b>Comunidade:</b> ${esc(household.community || '—')}</p>
      <p class="small"><b>Endereço / Ponto de Ref.:</b> ${esc(household.address || '—')}</p>
      <p class="small"><b>Capacidade da Cisterna:</b> ${household.defaultLiters || 5000} Litros</p>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">🌊 Meus Abastecimentos e Confirmação de PIN</h2>
      <div id="rList" class="records-grid"></div>
    </div>
  `;

  try {
    let qDeliveries;
    if (household.id) {
      qDeliveries = query(collection(db, "deliveries"), where("householdId", "==", household.id));
    } else {
      qDeliveries = query(collection(db, "deliveries"), where("recipientName", "==", state.profile.name));
    }

    const snap = await getDocs(qDeliveries);
    const container = $("rList");
    container.innerHTML = "";

    snap.docs.forEach(docSnap => {
      const item = docSnap.data();
      const deliveryId = docSnap.id;
      const st = translateStatus(item.status);

      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = item.status === "completed" ? "#a7f3d0" : item.status === "disputed" ? "#fca5a5" : item.status === "pending" ? "#fbcfe8" : "#bae6fd";
      
      let actionHtml = "";

      if (item.status === 'completed') {
        actionHtml = `
          <div style="margin-top:10px; background:#d1fae5; border:1px solid #6ee7b7; padding:8px 12px; border-radius:10px; text-align:center;">
            <p class="small" style="color:#065f46; font-weight:800;">✅ Abastecimento Concluído e Confirmado</p>
          </div>
        `;
      } else if (item.status === 'disputed') {
        actionHtml = `
          <div style="margin-top:10px; background:#fee2e2; border:1px solid #fca5a5; padding:8px 12px; border-radius:10px; text-align:center;">
            <p class="small" style="color:#991b1b; font-weight:800;">❌ Não Recebimento Registrado</p>
            <p class="small" style="color:#7f1d1d; margin-top:2px;">Motivo: ${esc(item.disputeReason)}</p>
          </div>
        `;
      } else if (item.status === 'pending') {
        actionHtml = `
          <div style="background:#fef3c7; border:1px solid #fde68a; padding:12px; border-radius:12px; margin-top:12px;">
            <p class="small" style="color:#92400e; font-weight:800; text-align:center;">⚠️ MOTORISTA REGISTROU AUSÊNCIA</p>
            <p class="small" style="margin-top:4px;"><b>Obs:</b> ${esc(item.note)}</p>
            <p class="small" style="margin-top:2px; color:var(--primary);"><b>PIN de Confirmação:</b> <span style="font-size:16px; font-weight:900;">${item.pin}</span></p>
            
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="primary small" style="flex:1;" id="confirmAbsent_${deliveryId}">✅ Confirmar Recebimento</button>
              <button class="danger small" style="flex:1;" id="disputeAbsent_${deliveryId}">❌ Não Recebi</button>
            </div>
            
            <div id="disputeBox_${deliveryId}" class="hidden" style="margin-top:10px;">
              <input type="text" id="disputeInput_${deliveryId}" placeholder="Informe o motivo do não recebimento..." style="margin-bottom:6px;">
              <button class="danger small" style="width:100%;" id="sendDispute_${deliveryId}">📤 Enviar Contestação ao Admin</button>
            </div>
          </div>
        `;
      } else {
        actionHtml = item.pin ? `
          <div class="pin-display-box">
            <p class="small" style="color:#047857; font-weight:800;">SEU CÓDIGO PIN PARA O MOTORISTA:</p>
            <div class="pin-code-badge">${item.pin}</div>
            <p class="small" style="color:#065f46; margin-top:4px;">Passe este número de 4 dígitos para o motorista no momento da entrega.</p>
          </div>
        ` : `
          <div style="margin-top:12px;">
            <label style="font-size:11px; margin-bottom:4px;">Observação Opcional para a Entrega</label>
            <input type="text" id="moradorObs_${deliveryId}" placeholder="Ex: Portão lateral aberto..." style="margin-bottom:8px;">
            <button class="primary small" style="width:100%;" id="genPin_${deliveryId}">🔑 Gerar PIN para o Motorista</button>
          </div>
        `;
      }

      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🌊 Entrega: ${dateOnly(item.scheduledDate)}</div>
          <span class="pill ${st.class}">${st.text}</span>
        </div>
        <p class="small"><b>Volume Agendado:</b> ${item.plannedLiters} L</p>
        <p class="small"><b>Motorista:</b> ${esc(item.driverName || '—')} (${esc(item.vehiclePlate || '—')})</p>
        ${item.alterReason ? `<p class="small" style="color:var(--warning); font-weight:700; margin-top:2px;">ℹ️ Ajuste de Volume: ${esc(item.alterReason)}</p>` : ''}
        ${actionHtml}
      `;

      if (!item.pin && item.status === 'scheduled') {
        el.querySelector(`#genPin_${deliveryId}`).onclick = async () => {
          const obsMorador = el.querySelector(`#moradorObs_${deliveryId}`).value.trim();
          const pin = Math.floor(1000 + Math.random() * 9000);
          await updateDoc(doc(db, "deliveries", deliveryId), { pin, moradorObs: obsMorador });
          toast(`PIN gerado: ${pin}`);
          renderRecipient();
        };
      }

      if (item.status === 'pending') {
        el.querySelector(`#confirmAbsent_${deliveryId}`).onclick = async () => {
          if (confirm("Deseja confirmar que a água foi efetivamente entregue?")) {
            await updateDoc(doc(db, "deliveries", deliveryId), { status: "completed", completedAt: serverTimestamp() });
            toast("Entrega confirmada com sucesso!");
            renderRecipient();
          }
        };

        const dispBox = el.querySelector(`#disputeBox_${deliveryId}`);
        el.querySelector(`#disputeAbsent_${deliveryId}`).onclick = () => {
          dispBox.classList.toggle("hidden");
        };

        el.querySelector(`#sendDispute_${deliveryId}`).onclick = async () => {
          const reason = el.querySelector(`#disputeInput_${deliveryId}`).value.trim();
          if (!reason) return alert("Informe o motivo do não recebimento.");
          await updateDoc(doc(db, "deliveries", deliveryId), { status: "disputed", disputeReason: reason });
          toast("Contestação enviada ao administrador!");
          renderRecipient();
        };
      }

      container.appendChild(el);
    });

    if (snap.docs.length === 0) {
      container.innerHTML = `<p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Nenhum agendamento de abastecimento encontrado para seu cadastro.</p>`;
    }
  } catch(e) {
    console.error(e);
  }
}

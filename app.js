import { auth, db, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { 
  user: null, 
  profile: null, 
  households: [], 
  deliveries: [], 
  drivers: [], 
  vehicles: [],
  filters: { category: "todos", driver: "todos", vehicle: "todos", date: "" }
};

let secondaryApp = null, secondaryAuth = null;
try {
  secondaryApp = initializeApp(firebaseConfig, "DriverRegistrationApp");
  secondaryAuth = getAuth(secondaryApp);
} catch (e) {}

function normalizePhone(val) {
  let d = String(val || "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d;
}

function recipientAuthEmail(phone) {
  const d = normalizePhone(phone);
  if (d.length < 10 || d.length > 11) throw new Error("Informe um telefone com DDD válido.");
  return `beneficiario.${d}@agua-para-todos.app`;
}

function loginIdentifierToEmail(id) {
  const v = String(id || "").trim();
  return v.includes("@") ? v.toLowerCase() : recipientAuthEmail(v);
}

function updateConnectionStatus() {
  const el = $("connectionStatus");
  if (!el) return;
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
updateConnectionStatus();

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

/* LOGIN */
if ($("loginForm")) {
  $("loginForm").onsubmit = async e => {
    e.preventDefault();
    if ($("loginMsg")) $("loginMsg").textContent = "";
    try {
      const email = loginIdentifierToEmail($("loginEmail").value.trim());
      await signInWithEmailAndPassword(auth, email, $("loginPassword").value);
    } catch (err) {
      if ($("loginMsg")) $("loginMsg").textContent = "Acesso negado: Verifique seus dados.";
    }
  };
}

/* AUTHENTICATION */
onAuthStateChanged(auth, async user => {
  if (!user) {
    state.user = null; state.profile = null;
    if ($("loginView")) $("loginView").classList.remove("hidden");
    if ($("appView")) $("appView").classList.add("hidden");
    return;
  }

  state.user = user;
  if ($("loginView")) $("loginView").classList.add("hidden");
  if ($("appView")) $("appView").classList.remove("hidden");

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) state.profile = { id: snap.id, ...snap.data() };
    if (!state.profile) { toast("Usuário sem perfil cadastrado."); return; }

    if ($("userName")) $("userName").textContent = state.profile.name || "Usuário Logado";
    if ($("userRole")) $("userRole").textContent = state.profile.role === "admin" ? "Administrador" : state.profile.role === "driver" ? "Motorista" : "Beneficiário";
    
    // Figurinhas dinâmicas conforme o perfil
    if ($("userAvatar")) {
      $("userAvatar").textContent = state.profile.role === "admin" ? "🛡️" : state.profile.role === "driver" ? "🚚" : "🏡";
    }

    await renderByRole();
  } catch (err) {
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

/* ADMIN DASHBOARD */
async function renderAdmin() {
  try {
    const [snapF, snapD, snapM, snapV] = await Promise.all([
      getDocs(collection(db, "households")),
      getDocs(query(collection(db, "deliveries"), limit(100))),
      getDocs(query(collection(db, "users"), where("role", "==", "driver"))),
      getDocs(collection(db, "vehicles"))
    ]);

    state.households = snapF.docs.map(d => ({ id: d.id, ...d.data() }));
    state.deliveries = snapD.docs.map(d => ({ id: d.id, ...d.data() }));
    state.drivers = snapM.docs.map(d => ({ id: d.id, ...d.data() }));
    state.vehicles = snapV.docs.map(d => ({ id: d.id, ...d.data() }));

    renderAdminDashboard();
  } catch (err) {
    console.error(err);
  }
}

function renderAdminDashboard() {
  const pending = state.deliveries.filter(d => d.status === "scheduled").length;
  const completed = state.deliveries.filter(d => d.status === "completed").length;

  $("adminPanel").innerHTML = `
    <!-- ESTATÍSTICAS -->
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-title);">Visão Geral do Programa</h2>
          <p class="small">Areia Branca/RN • Estatísticas em Tempo Real</p>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><span class="icon">🏡</span><div class="title">Famílias</div><div class="value">${state.households.length}</div></div>
        <div class="stat-card"><span class="icon">🚚</span><div class="title">Motoristas</div><div class="value">${state.drivers.length}</div></div>
        <div class="stat-card"><span class="icon">🚛</span><div class="title">Veículos</div><div class="value">${state.vehicles.length}</div></div>
        <div class="stat-card"><span class="icon">💧</span><div class="title">Entregas</div><div class="value">${state.deliveries.length}</div></div>
      </div>
    </div>

    <!-- BOTÕES DE CADASTRAR COM FIGURINHAS E EFEITO HOVER DINÂMICO -->
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="font-size: 18px; font-weight: 800;">Cadastros e Agendamento</h2>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px;">
        <button class="primary" id="btnNewFam">🏡 Família</button>
        <button class="primary" id="btnNewMot">🚚 Motorista</button>
        <button class="primary" id="btnNewVei">🚛 Veículo</button>
        <button class="accent" id="btnNewAg">💧 Agendar Entrega</button>
      </div>
    </div>

    <!-- MULTI-FILTRO AVANÇADO COMBINADO E CONSULTA -->
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">Consultar e Filtrar Registros</h2>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; background: #f8fafc; padding: 16px; border-radius: 16px; border: 1px solid var(--border); margin-bottom: 20px;">
        <div>
          <label>Categoria</label>
          <select id="filterCategory" style="margin-bottom:0;">
            <option value="todos">Todas as Categorias</option>
            <option value="familias">Famílias Rurais</option>
            <option value="motoristas">Motoristas</option>
            <option value="veiculos">Veículos</option>
            <option value="entregas">Entregas</option>
          </select>
        </div>

        <div>
          <label>Motorista</label>
          <select id="filterDriver" style="margin-bottom:0;">
            <option value="todos">Todos os Motoristas</option>
            ${state.drivers.map(d => `<option value="${d.name}">${esc(d.name)}</option>`).join("")}
          </select>
        </div>

        <div>
          <label>Veículo (Placa)</label>
          <select id="filterVehicle" style="margin-bottom:0;">
            <option value="todos">Todos os Veículos</option>
            ${state.vehicles.map(v => `<option value="${v.plate}">${esc(v.plate)} - ${esc(v.model)}</option>`).join("")}
          </select>
        </div>

        <div>
          <label>Data Específica</label>
          <input id="filterDate" type="date" style="margin-bottom:0;">
        </div>
      </div>

      <div id="dynamicRecords" class="records-grid"></div>
    </div>
  `;

  $("btnNewFam").onclick = () => showHouseholdForm();
  $("btnNewMot").onclick = () => showDriverForm();
  $("btnNewVei").onclick = () => showVehicleForm();
  $("btnNewAg").onclick = () => showDeliveryForm();

  $("filterCategory").onchange = (e) => { state.filters.category = e.target.value; renderDynamicRecords(); };
  $("filterDriver").onchange = (e) => { state.filters.driver = e.target.value; renderDynamicRecords(); };
  $("filterVehicle").onchange = (e) => { state.filters.vehicle = e.target.value; renderDynamicRecords(); };
  $("filterDate").onchange = (e) => { state.filters.date = e.target.value; renderDynamicRecords(); };

  renderDynamicRecords();
}

function renderDynamicRecords() {
  const container = $("dynamicRecords");
  if (!container) return;
  container.innerHTML = "";

  const { category, driver, vehicle, date } = state.filters;
  let count = 0;

  // 1. Famílias
  if (category === "todos" || category === "familias") {
    state.households.forEach(h => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🏡 Família: ${esc(h.name)}</div>
          <span class="pill completed">Ativa</span>
        </div>
        <p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
        <p class="small"><b>Endereço:</b> ${esc(h.address || '—')}</p>
        <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} L</p>
        <div style="display: flex; gap: 8px; margin-top: 14px;">
          <button class="secondary small" data-edit-fam="${h.id}">✏️ Alterar</button>
          <button class="danger small" data-del-fam="${h.id}">🗑️ Excluir</button>
        </div>
      `;
      el.querySelector("[data-edit-fam]").onclick = () => showHouseholdForm(h.id, h);
      el.querySelector("[data-del-fam]").onclick = async () => {
        if (confirm(`Excluir a família ${h.name}?`)) {
          await deleteDoc(doc(db, "households", h.id));
          toast("Família excluída!");
          renderAdmin();
        }
      };
      container.appendChild(el);
    });
  }

  // 2. Motoristas
  if (category === "todos" || category === "motoristas") {
    state.drivers.filter(d => driver === "todos" || d.name === driver).forEach(m => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#bae6fd";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🚚 Motorista: ${esc(m.name)}</div>
          <span class="pill scheduled">Ativo</span>
        </div>
        <p class="small"><b>E-mail:</b> ${esc(m.email)}</p>
        <p class="small"><b>Telefone:</b> ${esc(m.phone || '—')}</p>
        <div style="display: flex; gap: 8px; margin-top: 14px;">
          <button class="secondary small" data-edit-mot="${m.id}">✏️ Alterar</button>
          <button class="danger small" data-del-mot="${m.id}">🗑️ Excluir</button>
        </div>
      `;
      el.querySelector("[data-edit-mot]").onclick = () => showDriverForm(m.id, m);
      el.querySelector("[data-del-mot]").onclick = async () => {
        if (confirm(`Excluir o motorista ${m.name}?`)) {
          await deleteDoc(doc(db, "users", m.id));
          toast("Motorista excluído!");
          renderAdmin();
        }
      };
      container.appendChild(el);
    });
  }

  // 3. Veículos
  if (category === "todos" || category === "veiculos") {
    state.vehicles.filter(v => vehicle === "todos" || v.plate === vehicle).forEach(v => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#cbd5e1";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🚛 Veículo: ${esc(v.plate)}</div>
          <span class="pill scheduled">${v.capacity || 15000} L</span>
        </div>
        <p class="small"><b>Modelo:</b> ${esc(v.model)}</p>
        <p class="small"><b>KM Cadastrado:</b> ${v.km || 0} km</p>
        <div style="display: flex; gap: 8px; margin-top: 14px;">
          <button class="secondary small" data-edit-vei="${v.id}">✏️ Alterar</button>
          <button class="danger small" data-del-vei="${v.id}">🗑️ Excluir</button>
        </div>
      `;
      el.querySelector("[data-edit-vei]").onclick = () => showVehicleForm(v.id, v);
      el.querySelector("[data-del-vei]").onclick = async () => {
        if (confirm(`Excluir o veículo de placa ${v.plate}?`)) {
          await deleteDoc(doc(db, "vehicles", v.id));
          toast("Veículo excluído!");
          renderAdmin();
        }
      };
      container.appendChild(el);
    });
  }

  // 4. Entregas (com suporte aos múltiplos filtros simultâneos)
  if (category === "todos" || category === "entregas") {
    state.deliveries
      .filter(d => driver === "todos" || d.driverName === driver)
      .filter(d => vehicle === "todos" || d.vehiclePlate === vehicle)
      .filter(d => !date || d.scheduledDate === date)
      .forEach(d => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = d.status === "completed" ? "#a7f3d0" : "#fef08a";
        el.innerHTML = `
          <div class="record-header">
            <div class="record-title">💧 Entrega: ${esc(d.recipientName)}</div>
            <span class="pill ${d.status === 'completed' ? 'completed' : 'scheduled'}">${d.status === 'completed' ? 'Entregue' : 'Agendada'}</span>
          </div>
          <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || 'Não atribuído')} · <b>Veículo:</b> ${esc(d.vehiclePlate || 'Não informado')}</p>
          <div style="display: flex; gap: 8px; margin-top: 14px;">
            <button class="danger small" data-del-del="${d.id}">🗑️ Excluir Entrega</button>
          </div>
        `;
        el.querySelector("[data-del-del]").onclick = async () => {
          if (confirm("Excluir esta entrega agendada?")) {
            await deleteDoc(doc(db, "deliveries", d.id));
            toast("Entrega excluída!");
            renderAdmin();
          }
        };
        container.appendChild(el);
      });
  }

  if (count === 0) {
    container.innerHTML = `<p class="small" style="grid-column: 1/-1;">Nenhum registro encontrado para os critérios selecionados.</p>`;
  }
}

/* MODAIS COM ADIÇÃO E EDIÇÃO */
function showHouseholdForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 18px;">🏡 ${editId ? 'Editar' : 'Cadastrar'} Família Rural</h2>
    <form id="hForm">
      <label>Nome do Responsável <input id="hName" value="${data?.name || ''}" required></label>
      <label>Telefone / WhatsApp (Login) <input id="hPhone" type="tel" value="${data?.phone || ''}" placeholder="84999999999" required></label>
      <label>Senha ${editId ? '(Preencha apenas para alterar)' : 'Inicial'} <input id="hPassword" type="password" minlength="6" ${editId ? '' : 'required'}></label>
      <label>Comunidade <input id="hComm" value="${data?.community || ''}" required></label>
      <label>Endereço / Referência <input id="hAddr" value="${data?.address || ''}" required></label>
      <label>Volume Cisterna (Litros) <input id="hLit" type="number" value="${data?.defaultLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canH" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar Alterações' : 'Confirmar Cadastro'}</button>
      </div>
    </form>
  `);
  $("canH").onclick = closeModal;

  $("hForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      name: $("hName").value.trim(),
      phone: $("hPhone").value.trim(),
      community: $("hComm").value.trim(),
      address: $("hAddr").value.trim(),
      defaultLiters: Number($("hLit").value)
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "households", editId), payload);
        toast("Cadastro da família atualizado!");
      } else {
        const authEmail = recipientAuthEmail(payload.phone);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, $("hPassword").value);
        const ref = await addDoc(collection(db, "households"), { ...payload, recipientUid: cred.user.uid, active: true, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", cred.user.uid), { name: payload.name, phone: payload.phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp() });
        try { await signOutSecondary(secondaryAuth); } catch(e){}
        toast("Família cadastrada com sucesso!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDriverForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 18px;">🚚 ${editId ? 'Editar' : 'Cadastrar'} Motorista</h2>
    <form id="mForm">
      <label>Nome Completo <input id="mName" value="${data?.name || ''}" required></label>
      <label>E-mail de Login <input id="mEmail" type="email" value="${data?.email || ''}" required></label>
      <label>Telefone <input id="mPhone" type="tel" value="${data?.phone || ''}" required></label>
      <label>Senha ${editId ? '(Preencha para alterar)' : 'Inicial'} <input id="mPass" type="password" minlength="6" ${editId ? '' : 'required'}></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canM" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar Alterações' : 'Salvar Motorista'}</button>
      </div>
    </form>
  `);
  $("canM").onclick = closeModal;

  $("mForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      name: $("mName").value.trim(),
      email: $("mEmail").value.trim().toLowerCase(),
      phone: $("mPhone").value.trim()
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "users", editId), payload);
        toast("Dados do motorista atualizados!");
      } else {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, payload.email, $("mPass").value);
        await setDoc(doc(db, "users", cred.user.uid), { ...payload, role: "driver", active: true, createdAt: serverTimestamp() });
        try { await signOutSecondary(secondaryAuth); } catch(e){}
        toast("Motorista cadastrado com sucesso!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showVehicleForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 18px;">🚛 ${editId ? 'Editar' : 'Cadastrar'} Veículo (Caminhão-Pipa)</h2>
    <form id="vForm">
      <label>Placa do Veículo <input id="vPlate" value="${data?.plate || ''}" placeholder="ABC-1234" required></label>
      <label>Modelo / Descrição <input id="vModel" value="${data?.model || ''}" placeholder="Mercedes 15.000L" required></label>
      <label>Capacidade Tanque (Litros) <input id="vCap" type="number" value="${data?.capacity || 15000}" required></label>
      <label>KM Cadastrado <input id="vKm" type="number" value="${data?.km || 0}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canV" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar Alterações' : 'Cadastrar Veículo'}</button>
      </div>
    </form>
  `);
  $("canV").onclick = closeModal;

  $("vForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      plate: $("vPlate").value.trim().toUpperCase(),
      model: $("vModel").value.trim(),
      capacity: Number($("vCap").value),
      km: Number($("vKm").value)
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "vehicles", editId), payload);
        toast("Veículo atualizado com sucesso!");
      } else {
        await addDoc(collection(db, "vehicles"), { ...payload, createdAt: serverTimestamp() });
        toast("Veículo cadastrado com sucesso!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDeliveryForm() {
  openModal(`
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 18px;">💧 Programar Entrega</h2>
    <form id="dForm">
      <label>Família <select id="sFam" required><option value="">Selecione a família...</option>${state.households.map(h => `<option value="${h.id}">${esc(h.name)} - ${esc(h.community)}</option>`).join("")}</select></label>
      <label>Motorista <select id="sMot" required><option value="">Selecione o motorista...</option>${state.drivers.map(d => `<option value="${d.name}">${esc(d.name)}</option>`).join("")}</select></label>
      <label>Veículo <select id="sVei" required><option value="">Selecione o veículo...</option>${state.vehicles.map(v => `<option value="${v.plate}">${esc(v.plate)} - ${esc(v.model)}</option>`).join("")}</select></label>
      <label>Data Prevista <input id="sDate" type="date" required></label>
      <label>Volume (Litros) <input id="sLit" type="number" value="5000" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canD" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">Confirmar Agendamento</button>
      </div>
    </form>
  `);
  $("canD").onclick = closeModal;

  $("sFam").onchange = e => {
    const f = state.households.find(h => h.id === e.target.value);
    if (f && f.defaultLiters) $("sLit").value = f.defaultLiters;
  };

  $("dForm").onsubmit = async e => {
    e.preventDefault();
    const f = state.households.find(h => h.id === $("sFam").value);
    try {
      await addDoc(collection(db, "deliveries"), {
        householdId: f.id, 
        recipientName: f.name, 
        community: f.community, 
        address: f.address,
        driverName: $("sMot").value,
        vehiclePlate: $("sVei").value,
        scheduledDate: $("sDate").value, 
        plannedLiters: Number($("sLit").value),
        status: "scheduled", 
        createdAt: serverTimestamp()
      });
      closeModal();
      toast("Entrega agendada com sucesso!");
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

/* PAINÉIS SECUNDÁRIOS */
async function renderDriver() {
  $("driverPanel").innerHTML = `<div class="card"><h2 style="font-size: 20px; font-weight: 800;">🚚 Minhas Entregas Atribuídas</h2><div id="dList" class="records-grid" style="margin-top:16px;"></div></div>`;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("driverName", "==", state.profile.name)));
    $("dList").innerHTML = snap.docs.map(d => {
      const item = d.data();
      return `<div class="record-card"><div class="record-header"><div class="record-title">💧 ${esc(item.recipientName)}</div><span class="pill ${item.status}">${item.status}</span></div><p class="small"><b>Data:</b> ${dateOnly(item.scheduledDate)} · <b>Litros:</b> ${item.plannedLiters}L</p><p class="small"><b>Comunidade:</b> ${esc(item.community)}</p></div>`;
    }).join("") || "<p class='small'>Nenhuma entrega programada no momento.</p>";
  } catch(e){}
}

async function renderRecipient() {
  $("recipientPanel").innerHTML = `<div class="card"><h2 style="font-size: 20px; font-weight: 800;">🏡 Abastecimentos da Família</h2><div id="rList" class="records-grid" style="margin-top:16px;"></div></div>`;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("householdId", "==", state.profile.householdId)));
    $("rList").innerHTML = snap.docs.map(d => {
      const item = d.data();
      return `<div class="record-card"><div class="record-header"><div class="record-title">💧 Entrega em ${dateOnly(item.scheduledDate)}</div><span class="pill ${item.status}">${item.status}</span></div><p class="small"><b>Volume:</b> ${item.plannedLiters}L · <b>Motorista:</b> ${esc(item.driverName || '—')}</p></div>`;
    }).join("") || "<p class='small'>Nenhum abastecimento encontrado.</p>";
  } catch(e){}
}

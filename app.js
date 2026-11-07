import { auth, db, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const storage = getStorage();

const state = { 
  user: null, 
  profile: null, 
  households: [], 
  deliveries: [], 
  drivers: [], 
  vehicles: [],
  filters: { category: "", driver: "", vehicle: "", date: "" }
};

let secondaryApp = null, secondaryAuth = null;
try {
  secondaryApp = initializeApp(firebaseConfig, "DriverRegistrationApp");
  secondaryAuth = getAuth(secondaryApp);
} catch (e) {}

/* MÁSCARAS DE ENTRADA INTELIGENTES */
function applyPhoneMask(input) {
  input.addEventListener("input", e => {
    let v = e.target.value.replace(/\D/g, "").substring(0, 11);
    if (v.length > 10) {
      v = v.replace(/^(\d{2})(\d{5})(\d{4}).*/, "($1) $2-$3");
    } else if (v.length > 5) {
      v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    } else if (v.length > 2) {
      v = v.replace(/^(\d{2})(\d{0,5})/, "($1) $2");
    } else if (v.length > 0) {
      v = v.replace(/^(\d*)/, "($1");
    }
    e.target.value = v;
  });
}

function applyPlateMask(input) {
  input.addEventListener("input", e => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 7);
    if (v.length > 3) {
      v = v.substring(0, 3) + "-" + v.substring(3);
    }
    e.target.value = v;
  });
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
  return phoneAuthEmail(v);
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

/* LOGIN */
if ($("loginForm")) {
  $("loginForm").onsubmit = async e => {
    e.preventDefault();
    if ($("loginMsg")) $("loginMsg").textContent = "";
    try {
      const email = loginIdentifierToEmail($("loginEmail").value.trim());
      await signInWithEmailAndPassword(auth, email, $("loginPassword").value);
    } catch (err) {
      if ($("loginMsg")) $("loginMsg").textContent = "Acesso negado: Verifique seu telefone/senha.";
    }
  };
}

/* AUTHENTICATION */
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
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) state.profile = { id: snap.id, ...snap.data() };
    if (!state.profile) { toast("Usuário sem perfil cadastrado."); return; }

    if ($("userName")) $("userName").textContent = state.profile.name || "Usuário";
    if ($("userRole")) $("userRole").textContent = state.profile.role === "admin" ? "Administrador" : state.profile.role === "driver" ? "Motorista" : "Beneficiário";
    if ($("userAvatar")) $("userAvatar").textContent = state.profile.role === "admin" ? "🛡️" : state.profile.role === "driver" ? "🚚" : "🏡";

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
  const scheduled = state.deliveries.filter(d => d.status === "scheduled").length;
  const completed = state.deliveries.filter(d => d.status === "completed").length;
  const pending = state.deliveries.filter(d => d.status === "pending_absent").length;

  $("adminPanel").innerHTML = `
    <div class="card">
      <div style="margin-bottom: 14px;">
        <h2 style="font-size: 18px; font-weight: 800; color: var(--text-title);">Visão Geral do Programa</h2>
        <p class="small">Areia Branca/RN • Indicadores do Sistema</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><span class="icon">📅</span><div class="title">Programadas</div><div class="value">${scheduled}</div></div>
        <div class="stat-card"><span class="icon">✅</span><div class="title">Realizadas</div><div class="value">${completed}</div></div>
        <div class="stat-card"><span class="icon">⏳</span><div class="title">Pendentes / Ausentes</div><div class="value">${pending}</div></div>
      </div>
    </div>

    <!-- BOTÕES DE CADASTRO -->
    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Cadastros e Operações</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
        <button class="primary" id="btnNewFam">🏡 Família</button>
        <button class="primary" id="btnNewMot">🚚 Motorista</button>
        <button class="primary" id="btnNewVei">🚛 Veículo</button>
        <button class="accent" id="btnNewAg">💧 Agendar</button>
      </div>
    </div>

    <!-- FILTROS AVANÇADOS COM BOTÕES ESTILIZADOS -->
    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Filtrar Registros</h2>

      <div style="background: #f8fafc; padding: 16px; border-radius: 14px; border: 1px solid var(--border); margin-bottom: 16px;">
        <label>Selecione a Categoria</label>
        <div class="filter-options" id="catFilterButtons">
          <button type="button" class="filter-btn active" data-cat="">Selecione...</button>
          <button type="button" class="filter-btn" data-cat="familias">🏡 Famílias</button>
          <button type="button" class="filter-btn" data-cat="motoristas">🚚 Motoristas</button>
          <button type="button" class="filter-btn" data-cat="veiculos">🚛 Veículos</button>
          <button type="button" class="filter-btn" data-cat="entregas">💧 Entregas</button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 14px;">
          <div>
            <label>Motorista</label>
            <select id="filterDriver" style="margin-bottom:0;">
              <option value="">Todos</option>
              ${state.drivers.map(d => `<option value="${d.name}">${esc(d.name)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Veículo</label>
            <select id="filterVehicle" style="margin-bottom:0;">
              <option value="">Todos</option>
              ${state.vehicles.map(v => `<option value="${v.plate}">${esc(v.plate)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Data</label>
            <input id="filterDate" type="date" style="margin-bottom:0;">
          </div>
        </div>
      </div>

      <div id="dynamicRecords" class="records-grid">
        <p class="small" style="text-align: center; grid-column: 1/-1; padding: 20px;">Selecione uma categoria acima para exibir os registros correspondentes.</p>
      </div>
    </div>
  `;

  $("btnNewFam").onclick = () => showHouseholdForm();
  $("btnNewMot").onclick = () => showDriverForm();
  $("btnNewVei").onclick = () => showVehicleForm();
  $("btnNewAg").onclick = () => showDeliveryForm();

  document.querySelectorAll("#catFilterButtons .filter-btn").forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll("#catFilterButtons .filter-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      state.filters.category = e.target.dataset.cat;
      renderDynamicRecords();
    };
  });

  $("filterDriver").onchange = (e) => { state.filters.driver = e.target.value; renderDynamicRecords(); };
  $("filterVehicle").onchange = (e) => { state.filters.vehicle = e.target.value; renderDynamicRecords(); };
  $("filterDate").onchange = (e) => { state.filters.date = e.target.value; renderDynamicRecords(); };
}

function renderDynamicRecords() {
  const container = $("dynamicRecords");
  if (!container) return;
  container.innerHTML = "";

  const { category, driver, vehicle, date } = state.filters;
  
  if (!category) {
    container.innerHTML = `<p class="small" style="text-align: center; grid-column: 1/-1; padding: 20px;">Selecione uma categoria acima para exibir os registros correspondentes.</p>`;
    return;
  }

  let count = 0;

  if (category === "familias") {
    state.households.forEach(h => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.innerHTML = `
        <div class="record-header"><div class="record-title">🏡 Família: ${esc(h.name)}</div><span class="pill completed">Ativa</span></div>
        <p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
        <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} L</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
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

  if (category === "motoristas") {
    state.drivers.filter(d => !driver || d.name === driver).forEach(m => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#bae6fd";
      el.innerHTML = `
        <div class="record-header"><div class="record-title">🚚 Motorista: ${esc(m.name)}</div><span class="pill scheduled">Ativo</span></div>
        <p class="small"><b>Telefone:</b> ${esc(m.phone || '—')}</p>
        <p class="small"><b>Veículo Vinculado:</b> ${esc(m.vehiclePlate || 'Nenhum')}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
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

  if (category === "veiculos") {
    state.vehicles.filter(v => !vehicle || v.plate === vehicle).forEach(v => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#cbd5e1";
      el.innerHTML = `
        <div class="record-header"><div class="record-title">🚛 Veículo: ${esc(v.plate)}</div><span class="pill scheduled">${v.capacity || 15000} L</span></div>
        <p class="small"><b>Modelo:</b> ${esc(v.model)}</p>
        <p class="small"><b>Motorista Vinculado:</b> ${esc(v.driverName || 'Nenhum')}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="secondary small" data-edit-vei="${v.id}">✏️ Alterar</button>
          <button class="danger small" data-del-vei="${v.id}">🗑️ Excluir</button>
        </div>
      `;
      el.querySelector("[data-edit-vei]").onclick = () => showVehicleForm(v.id, v);
      el.querySelector("[data-del-vei]").onclick = async () => {
        if (confirm(`Excluir o veículo ${v.plate}?`)) {
          await deleteDoc(doc(db, "vehicles", v.id));
          toast("Veículo excluído!");
          renderAdmin();
        }
      };
      container.appendChild(el);
    });
  }

  if (category === "entregas") {
    state.deliveries
      .filter(d => !driver || d.driverName === driver)
      .filter(d => !vehicle || d.vehiclePlate === vehicle)
      .filter(d => !date || d.scheduledDate === date)
      .forEach(d => {
        count++;
        const statusClass = d.status === 'completed' ? 'completed' : d.status === 'pending_absent' ? 'pending' : 'scheduled';
        const statusText = d.status === 'completed' ? 'Realizada' : d.status === 'pending_absent' ? 'Pendente/Ausente' : 'Programada';

        const el = document.createElement("div");
        el.className = "record-card";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">💧 Entrega: ${esc(d.recipientName)}</div><span class="pill ${statusClass}">${statusText}</span></div>
          <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
          ${d.pin ? `<p class="small"><b>PIN:</b> ${d.pin}</p>` : ''}
          ${d.photoUrl ? `<p class="small"><a href="${d.photoUrl}" target="_blank">📸 Ver Foto da Ausência</a></p>` : ''}
          ${d.lat && d.lng ? `<p class="small">📍 <b>GPS:</b> ${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}</p>` : ''}
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button class="secondary small" data-edit-del="${d.id}">✏️ Alterar</button>
            <button class="danger small" data-del-del="${d.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-del]").onclick = () => showDeliveryForm(d.id, d);
        el.querySelector("[data-del-del]").onclick = async () => {
          if (confirm("Excluir esta entrega?")) {
            await deleteDoc(doc(db, "deliveries", d.id));
            toast("Entrega excluída!");
            renderAdmin();
          }
        };
        container.appendChild(el);
      });
  }

  if (count === 0) {
    container.innerHTML = `<p class="small" style="grid-column: 1/-1; text-align:center;">Nenhum registro encontrado para os filtros selecionados.</p>`;
  }
}

/* MODAIS DE CADASTRO COM MÁSCARAS */
function showHouseholdForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🏡 ${editId ? 'Editar' : 'Cadastrar'} Família Rural</h2>
    <form id="hForm">
      <label>Nome do Responsável <input id="hName" value="${data?.name || ''}" required></label>
      <label>Telefone / WhatsApp (Login) <input id="hPhone" type="tel" value="${data?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha ${editId ? '(Preencha apenas para alterar)' : 'Inicial'} <input id="hPassword" type="password" minlength="6" ${editId ? '' : 'required'}></label>
      <label>Comunidade <input id="hComm" value="${data?.community || ''}" required></label>
      <label>Endereço / Referência <input id="hAddr" value="${data?.address || ''}" required></label>
      <label>Volume Cisterna (Litros) <input id="hLit" type="number" value="${data?.defaultLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canH" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar'}</button>
      </div>
    </form>
  `);
  applyPhoneMask($("hPhone"));
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
        toast("Família atualizada!");
      } else {
        const authEmail = phoneAuthEmail(payload.phone);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, $("hPassword").value);
        const ref = await addDoc(collection(db, "households"), { ...payload, recipientUid: cred.user.uid, active: true, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", cred.user.uid), { name: payload.name, phone: payload.phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp() });
        try { await signOutSecondary(secondaryAuth); } catch(e){}
        toast("Família cadastrada!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDriverForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🚚 ${editId ? 'Editar' : 'Cadastrar'} Motorista</h2>
    <form id="mForm">
      <label>Nome Completo <input id="mName" value="${data?.name || ''}" required></label>
      <label>Telefone / WhatsApp (Login) <input id="mPhone" type="tel" value="${data?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha ${editId ? '(Preencha para alterar)' : 'Inicial'} <input id="mPass" type="password" minlength="6" ${editId ? '' : 'required'}></label>
      <label>Vincular Veículo (Placa) 
        <select id="mVei">
          <option value="">Nenhum veículo vinculado</option>
          ${state.vehicles.map(v => `<option value="${v.plate}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${v.plate} - ${v.model}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canM" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Salvar Motorista'}</button>
      </div>
    </form>
  `);
  applyPhoneMask($("mPhone"));
  $("canM").onclick = closeModal;

  $("mForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      name: $("mName").value.trim(),
      phone: $("mPhone").value.trim(),
      vehiclePlate: $("mVei").value || ""
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "users", editId), payload);
        toast("Motorista atualizado!");
      } else {
        const authEmail = phoneAuthEmail(payload.phone);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, $("mPass").value);
        await setDoc(doc(db, "users", cred.user.uid), { ...payload, authEmail, role: "driver", active: true, createdAt: serverTimestamp() });
        try { await signOutSecondary(secondaryAuth); } catch(e){}
        toast("Motorista cadastrado!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showVehicleForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🚛 ${editId ? 'Editar' : 'Cadastrar'} Veículo</h2>
    <form id="vForm">
      <label>Placa do Veículo <input id="vPlate" value="${data?.plate || ''}" placeholder="ABC-1234" required></label>
      <label>Modelo / Descrição <input id="vModel" value="${data?.model || ''}" placeholder="Mercedes 15.000L" required></label>
      <label>Capacidade (Litros) <input id="vCap" type="number" value="${data?.capacity || 15000}" required></label>
      <label>Vincular Motorista 
        <select id="vMot">
          <option value="">Nenhum motorista vinculado</option>
          ${state.drivers.map(m => `<option value="${m.name}" ${data?.driverName === m.name ? 'selected' : ''}>${m.name}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canV" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar Veículo'}</button>
      </div>
    </form>
  `);
  applyPlateMask($("vPlate"));
  $("canV").onclick = closeModal;

  $("vForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      plate: $("vPlate").value.trim().toUpperCase(),
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
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDeliveryForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">💧 ${editId ? 'Editar' : 'Programar'} Entrega</h2>
    <form id="dForm">
      <label>Família <select id="sFam" required><option value="">Selecione...</option>${state.households.map(h => `<option value="${h.id}" ${data?.householdId === h.id ? 'selected' : ''}>${esc(h.name)} - ${esc(h.community)}</option>`).join("")}</select></label>
      <label>Motorista <select id="sMot" required><option value="">Selecione...</option>${state.drivers.map(m => `<option value="${m.name}" ${data?.driverName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join("")}</select></label>
      <label>Veículo <select id="sVei" required><option value="">Selecione...</option>${state.vehicles.map(v => `<option value="${v.plate}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${esc(v.plate)}</option>`).join("")}</select></label>
      <label>Data Prevista <input id="sDate" type="date" value="${data?.scheduledDate || ''}" required></label>
      <label>Volume (Litros) <input id="sLit" type="number" value="${data?.plannedLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canD" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Confirmar Agendamento'}</button>
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

/* PAINEL DO MOTORISTA (PIN, FOTO, GPS) */
async function renderDriver() {
  $("driverPanel").innerHTML = `
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800;">🚚 Minhas Entregas Atribuídas</h2>
      <div id="dList" class="records-grid" style="margin-top:16px;"></div>
    </div>
  `;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("driverName", "==", state.profile.name)));
    const container = $("dList");
    container.innerHTML = "";

    snap.docs.forEach(docSnap => {
      const item = { id: docSnap.id, ...docSnap.data() };
      const el = document.createElement("div");
      el.className = "record-card";
      el.innerHTML = `
        <div class="record-header"><div class="record-title">💧 ${esc(item.recipientName)}</div><span class="pill ${item.status}">${item.status}</span></div>
        <p class="small"><b>Data:</b> ${dateOnly(item.scheduledDate)} · <b>Litros:</b> ${item.plannedLiters}L</p>
        <p class="small"><b>Comunidade:</b> ${esc(item.community)} · <b>Endereço:</b> ${esc(item.address)}</p>
        ${item.status === 'scheduled' ? `
          <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 8px;">
            <input type="text" placeholder="Digite o PIN de 4 dígitos do morador" id="pinInput_${item.id}" maxlength="4" style="margin-bottom:0;">
            <button class="primary small" data-confirm-pin="${item.id}">🔑 Confirmar com PIN</button>
            <button class="danger small" data-absent="${item.id}">⚠️ Morador Ausente (Foto/Obs)</button>
          </div>
        ` : `<p class="small" style="margin-top:10px; color:var(--success);"><b>Operação Concluída</b></p>`}
      `;

      if (item.status === 'scheduled') {
        el.querySelector(`[data-confirm-pin="${item.id}"]`).onclick = async () => {
          const enteredPin = $(`pinInput_${item.id}`).value.trim();
          if (enteredPin !== item.pin) {
            alert("PIN incorreto!");
            return;
          }

          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async pos => {
              await updateDoc(doc(db, "deliveries", item.id), {
                status: "completed",
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                completedAt: serverTimestamp()
              });
              toast("Entrega confirmada com GPS!");
              renderDriver();
            }, () => {
              alert("Não foi possível obter a localização GPS.");
            });
          } else {
            alert("Geolocalização não suportada.");
          }
        };

        el.querySelector(`[data-absent="${item.id}"]`).onclick = () => {
          openModal(`
            <h2>⚠️ Registrar Ausência de Morador</h2>
            <form id="absentForm">
              <label>Observação <textarea id="obsText" required placeholder="Explique o motivo..."></textarea></label>
              <label>Foto do Local <input type="file" id="photoFile" accept="image/*" required></label>
              <div style="display:flex; gap:10px; margin-top:10px;">
                <button type="button" class="secondary" id="canAbs" style="flex:1;">Voltar</button>
                <button type="submit" class="danger" style="flex:2;">Enviar Registro</button>
              </div>
            </form>
          `);
          $("canAbs").onclick = closeModal;

          $("absentForm").onsubmit = async ev => {
            ev.preventDefault();
            const file = $("photoFile").files[0];
            const obs = $("obsText").value.trim();
            try {
              const storageRef = ref(storage, `ausencias/${item.id}_${Date.now()}.jpg`);
              await uploadBytes(storageRef, file);
              const photoUrl = await getDownloadURL(storageRef);

              await updateDoc(doc(db, "deliveries", item.id), {
                status: "pending_absent",
                note: obs,
                photoUrl,
                updatedAt: serverTimestamp()
              });

              closeModal();
              toast("Ausência registrada com sucesso!");
              renderDriver();
            } catch(err) { alert("Erro ao enviar: " + err.message); }
          };
        };
      }

      container.appendChild(el);
    });

    if (container.children.length === 0) {
      container.innerHTML = `<p class="small">Nenhuma entrega programada no momento.</p>`;
    }
  } catch(e){}
}

/* PAINEL DO BENEFICIÁRIO (VISUALIZAR CADASTRO E GERAR PIN) */
async function renderRecipient() {
  const panel = $("recipientPanel");
  panel.innerHTML = `<div class="card"><h2 style="font-size: 18px; font-weight: 800;">🏡 Informações da Família e Abastecimentos</h2><div id="recContainer" style="margin-top:16px;"><p class="small">Carregando...</p></div></div>`;
  
  try {
    const hSnap = await getDoc(doc(db, "households", state.profile.householdId));
    const household = hSnap.exists() ? hSnap.data() : {};

    const dSnap = await getDocs(query(collection(db, "deliveries"), where("householdId", "==", state.profile.householdId)));
    
    let html = `
      <div style="background:#f8fafc; padding:16px; border-radius:14px; border:1px solid var(--border); margin-bottom:20px;">
        <h3 style="font-size:15px; font-weight:800; margin-bottom:8px;">👤 Dados Cadastrais</h3>
        <p class="small"><b>Responsável:</b> ${esc(household.name)}</p>
        <p class="small"><b>Telefone:</b> ${esc(household.phone)}</p>
        <p class="small"><b>Comunidade:</b> ${esc(household.community)}</p>
        <p class="small"><b>Endereço:</b> ${esc(household.address)}</p>
        <p class="small"><b>Volume Cisterna:</b> ${household.defaultLiters || 5000} Litros</p>
      </div>
      <h3 style="font-size:16px; font-weight:800; margin-bottom:12px;">💧 Agendamentos e Confirmação</h3>
    `;

    dSnap.docs.forEach(docSnap => {
      const item = { id: docSnap.id, ...docSnap.data() };
      html += `
        <div class="record-card" style="margin-bottom:12px;">
          <div class="record-header"><div class="record-title">Entrega em ${dateOnly(item.scheduledDate)}</div><span class="pill ${item.status}">${item.status}</span></div>
          <p class="small"><b>Volume:</b> ${item.plannedLiters}L · <b>Motorista:</b> ${esc(item.driverName || '—')}</p>
          ${item.status === 'scheduled' ? `
            <div style="margin-top:12px;">
              ${item.pin ? `<p style="font-size:16px; font-weight:900; color:var(--primary); background:#e0f2fe; padding:8px; border-radius:8px; text-align:center;">PIN DE CONFIRMAÇÃO: ${item.pin}</p>` : `<button class="primary small" data-gen-pin="${item.id}">🔑 Gerar PIN para o Motorista</button>`}
            </div>
          ` : ''}
        </div>
      `;
    });

    $("recContainer").innerHTML = html || "<p class='small'>Nenhum abastecimento encontrado.</p>";

    document.querySelectorAll("[data-gen-pin]").forEach(btn => {
      btn.onclick = async () => {
        const deliveryId = btn.dataset.genPin;
        const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
        await updateDoc(doc(db, "deliveries", deliveryId), { pin: randomPin });
        toast("PIN gerado com sucesso!");
        renderRecipient();
      };
    });

  } catch(e) { console.error(e); }
}

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
  query,
  where,
  orderBy,
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

// Inicialização do Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Elementos DOM principais
const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginEmailInput = document.getElementById("loginEmail");
const loginPasswordInput = document.getElementById("loginPassword");
const loginMsg = document.getElementById("loginMsg");
const logoutBtn = document.getElementById("logoutBtn");

const userNameEl = document.getElementById("userName");
const userRoleEl = document.getElementById("userRole");
const connectionStatusEl = document.getElementById("connectionStatus");

const adminPanel = document.getElementById("adminPanel");
const driverPanel = document.getElementById("driverPanel");
const recipientPanel = document.getElementById("recipientPanel");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalContent = document.getElementById("modalContent");
const closeModalBtn = document.getElementById("closeModal");
const toastEl = document.getElementById("toast");

// Variáveis de Estado
let currentUser = null;
let currentUserProfile = null;
let signatureCanvas = null;
let signatureCtx = null;
let isDrawing = false;
let photoBase64 = null;

// ==========================================
// UTILITÁRIOS: TOAST E MODAL
// ==========================================
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3500);
}

function openModal(title, htmlContent) {
  if (!modal || !modalTitle || !modalContent) return;
  modalTitle.textContent = title;
  modalContent.innerHTML = htmlContent;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal() {
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (modalContent) modalContent.innerHTML = "";
  photoBase64 = null;
  signatureCanvas = null;
  signatureCtx = null;
}

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", closeModal);
}

if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}

// Monitor de Conexão Online/Offline
window.addEventListener("online", () => {
  if (connectionStatusEl) {
    connectionStatusEl.textContent = "Online";
    connectionStatusEl.className = "status ok";
  }
});
window.addEventListener("offline", () => {
  if (connectionStatusEl) {
    connectionStatusEl.textContent = "Offline";
    connectionStatusEl.className = "status";
  }
});

// ==========================================
// AUTENTICAÇÃO (E-MAIL OU TELEFONE)
// ==========================================
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginMsg.textContent = "";

    const identifier = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;

    if (!identifier || !password) {
      loginMsg.textContent = "Por favor, preencha todos os campos.";
      return;
    }

    let emailToAuth = identifier;

    // Se o usuário digitou telefone (apenas números ou DDD), converte para o formato de e-mail do sistema
    const phoneClean = identifier.replace(/\D/g, "");
    if (!identifier.includes("@") && phoneClean.length >= 8) {
      emailToAuth = `${phoneClean}@aguaparatodos.local`;
    }

    try {
      const submitBtn = loginForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Entrando…";
      }

      await signInWithEmailAndPassword(auth, emailToAuth, password);
    } catch (err) {
      console.error("Erro no login:", err);
      let mensagem = "Falha ao entrar. Verifique os dados.";
      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/user-not-found" ||
        err.code === "auth/wrong-password"
      ) {
        mensagem = "Telefone/E-mail ou senha incorretos.";
      } else if (err.code === "auth/network-request-failed") {
        mensagem = "Sem conexão com a internet.";
      }
      loginMsg.textContent = mensagem;
    } finally {
      const submitBtn = loginForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Entrar no Sistema";
      }
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        currentUserProfile = userDoc.data();
      } else {
        currentUserProfile = {
          name: user.email.split("@")[0],
          role: "driver"
        };
      }

      carregarInterfaceUsuario();
    } catch (e) {
      console.error("Erro ao carregar perfil:", e);
      currentUserProfile = { name: "Usuário", role: "driver" };
      carregarInterfaceUsuario();
    }
  } else {
    currentUser = null;
    currentUserProfile = null;
    mostrarLogin();
  }
});

function mostrarLogin() {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  if (loginForm) loginForm.reset();
  if (loginMsg) loginMsg.textContent = "";
}

function carregarInterfaceUsuario() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");

  userNameEl.textContent = currentUserProfile.name || "Usuário";
  userRoleEl.textContent = formatarCargo(currentUserProfile.role);

  if (connectionStatusEl) {
    connectionStatusEl.textContent = navigator.onLine ? "Online" : "Offline";
    connectionStatusEl.className = navigator.onLine ? "status ok" : "status";
  }

  adminPanel.classList.add("hidden");
  driverPanel.classList.add("hidden");
  recipientPanel.classList.add("hidden");

  if (currentUserProfile.role === "admin") {
    adminPanel.classList.remove("hidden");
    renderizarPainelAdmin();
  } else if (currentUserProfile.role === "recipient") {
    recipientPanel.classList.remove("hidden");
    renderizarPainelBeneficiario();
  } else {
    driverPanel.classList.remove("hidden");
    renderizarPainelMotorista();
  }
}

function formatarCargo(role) {
  if (role === "admin") return "Administrador";
  if (role === "driver") return "Motorista / Pipa";
  if (role === "recipient") return "Beneficiário";
  return "Usuário";
}

// ==========================================
// PAINEL DO MOTORISTA
// ==========================================
async function renderizarPainelMotorista() {
  driverPanel.innerHTML = `
    <div class="panel-title">
      <h2>Entregas de Hoje</h2>
      <button id="btnAtualizarEntregas" class="secondary" type="button">Atualizar</button>
    </div>
    <div id="listaEntregasMotorista" class="grid">
      <p class="small">Carregando abastecimentos...</p>
    </div>
  `;

  document.getElementById("btnAtualizarEntregas").addEventListener("click", carregarEntregasMotorista);
  await carregarEntregasMotorista();
}

async function carregarEntregasMotorista() {
  const container = document.getElementById("listaEntregasMotorista");
  if (!container) return;

  try {
    const q = query(
      collection(db, "deliveries"),
      where("driverUid", "==", currentUser.uid)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="item">
          <p>Nenhuma entrega agendada para seu caminhão no momento.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    snapshot.forEach((d) => {
      const data = d.data();
      const id = d.id;
      const card = document.createElement("div");
      card.className = "item";

      const statusClass =
        data.status === "completed"
          ? "completed"
          : data.status === "absent"
          ? "absent"
          : "scheduled";

      const statusTexto =
        data.status === "completed"
          ? "Concluído"
          : data.status === "absent"
          ? "Ausente"
          : "Pendente";

      card.innerHTML = `
        <div class="row">
          <h3>${data.recipientName || "Família sem nome"}</h3>
          <span class="pill ${statusClass}">${statusTexto}</span>
        </div>
        <p><strong>Comunidade:</strong> ${data.community || "Zona Rural"}</p>
        <p><strong>Endereço:</strong> ${data.address || "Não informado"}</p>
        <p><strong>Volume Previsto:</strong> ${data.plannedLiters || 0} Litros</p>
        
        <div class="actions" style="margin-top: 14px;">
          ${
            data.status !== "completed"
              ? `<button class="primary" data-action="confirm" data-id="${id}">Realizar Abastecimento</button>`
              : ""
          }
          <button class="secondary" data-action="view" data-id="${id}">Ver Detalhes</button>
        </div>
      `;

      card.querySelector("[data-action='view']").addEventListener("click", () => {
        abrirDetalhesEntrega(id, data);
      });

      const confirmBtn = card.querySelector("[data-action='confirm']");
      if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
          abrirModalAbastecimento(id, data);
        });
      }

      container.appendChild(card);
    });
  } catch (err) {
    console.error("Erro ao carregar entregas:", err);
    container.innerHTML = `<p class="message">Erro ao carregar entregas do motorista.</p>`;
  }
}

// Modal de Execução de Entrega (Foto + Assinatura)
function abrirModalAbastecimento(id, data) {
  const html = `
    <form id="formAbastecimento">
      <div class="notice">
        <strong>${data.recipientName}</strong><br>
        ${data.community} • ${data.plannedLiters} Litros previstos
      </div>

      <label>
        Litros Entregues
        <input id="recLiters" type="number" value="${data.plannedLiters || 0}" required>
      </label>

      <label>
        O responsável estava presente?
        <select id="recPresent">
          <option value="sim">Sim, presente</option>
          <option value="nao">Não, abastecido com autorização</option>
        </select>
      </label>

      <label>
        Foto da Entrega (Caminhão / Cisterna)
        <input id="recPhotoInput" type="file" accept="image/*" capture="environment">
      </label>
      <img id="recPhotoPreview" class="photo-preview hidden" alt="Prévia da entrega">

      <label>
        Assinatura do Recebedor (Desenhe com o dedo)
        <canvas id="canvasSignature" class="signature"></canvas>
      </label>
      <button id="btnClearSig" type="button" class="secondary" style="min-height: 38px; padding: 6px 12px; margin-top: -6px;">Limpar Assinatura</button>

      <label>
        Observações
        <textarea id="recNote" placeholder="Ex: Tanque limpo, estrada com areia fofa..."></textarea>
      </label>

      <div class="actions" style="margin-top: 18px;">
        <button type="submit" class="primary" style="flex: 2;">Confirmar Abastecimento</button>
        <button type="button" class="secondary" id="btnCancelModal" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openModal("Confirmar Abastecimento", html);

  document.getElementById("btnCancelModal").addEventListener("click", closeModal);

  // Inicializa o Canvas da Assinatura
  signatureCanvas = document.getElementById("canvasSignature");
  if (signatureCanvas) {
    signatureCtx = signatureCanvas.getContext("2d");
    ajustarDimensoesCanvas(signatureCanvas);
    configurarEventosDesenho(signatureCanvas, signatureCtx);
  }

  document.getElementById("btnClearSig").addEventListener("click", () => {
    if (signatureCtx && signatureCanvas) {
      signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
  });

  // Captura de Foto
  const photoInput = document.getElementById("recPhotoInput");
  const photoPreview = document.getElementById("recPhotoPreview");

  photoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        photoPreview.src = event.target.result;
        photoPreview.classList.remove("hidden");
        photoBase64 = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  // Salvar Entrega
  document.getElementById("formAbastecimento").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btnSubmit = e.target.querySelector("button[type='submit']");
    btnSubmit.disabled = true;
    btnSubmit.textContent = "Salvando dados...";

    try {
      const litros = Number(document.getElementById("recLiters").value);
      const presente = document.getElementById("recPresent").value === "sim";
      const nota = document.getElementById("recNote").value;

      let signatureDataUrl = null;
      if (signatureCanvas) {
        signatureDataUrl = signatureCanvas.toDataURL("image/png");
      }

      let uploadedPhotoUrl = "";
      if (photoInput.files[0]) {
        const file = photoInput.files[0];
        const sRef = storageRef(storage, `entregas/${id}_${Date.now()}.jpg`);
        await uploadBytes(sRef, file);
        uploadedPhotoUrl = await getDownloadURL(sRef);
      }

      await updateDoc(doc(db, "deliveries", id), {
        status: "completed",
        receivedLiters: litros,
        recipientPresent: presente,
        note: nota,
        signatureData: signatureDataUrl,
        photoUrl: uploadedPhotoUrl,
        completedAt: serverTimestamp(),
        completedBy: currentUser.uid
      });

      showToast("Abastecimento registrado com sucesso!");
      closeModal();
      carregarEntregasMotorista();
    } catch (err) {
      console.error("Erro ao salvar:", err);
      alert("Não foi possível salvar o abastecimento. Tente novamente.");
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Confirmar Abastecimento";
    }
  });
}

function ajustarDimensoesCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

function configurarEventosDesenho(canvas, ctx) {
  ctx.strokeStyle = "#0D2B5C";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function start(e) {
    isDrawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  function move(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  }

  function stop() {
    isDrawing = false;
  }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", stop);

  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", stop);
}

// Detalhes da Entrega
function abrirDetalhesEntrega(id, data) {
  const html = `
    <div style="display: grid; gap: 12px;">
      <p><strong>Beneficiário:</strong> ${data.recipientName || "Não informado"}</p>
      <p><strong>Comunidade:</strong> ${data.community || "Não informada"}</p>
      <p><strong>Endereço:</strong> ${data.address || "Não informado"}</p>
      <p><strong>Telefone:</strong> ${data.recipientPhone || "Não informado"}</p>
      <p><strong>Volume Previsto:</strong> ${data.plannedLiters || 0} L</p>
      <p><strong>Volume Entregue:</strong> ${data.receivedLiters ? `${data.receivedLiters} L` : "Pendente"}</p>
      <p><strong>Status:</strong> ${data.status}</p>
      ${data.note ? `<p><strong>Observações:</strong> ${data.note}</p>` : ""}
      ${
        data.photoUrl
          ? `<p><strong>Registro Fotográfico:</strong></p><img src="${data.photoUrl}" class="photo-preview" alt="Foto comprovante">`
          : ""
      }
      ${
        data.signatureData
          ? `<p><strong>Assinatura:</strong></p><img src="${data.signatureData}" style="max-height: 120px; border: 1px solid var(--border); border-radius: 8px;" alt="Assinatura">`
          : ""
      }
      <div class="actions" style="margin-top: 16px;">
        <button type="button" class="secondary" id="btnCloseDetails" style="width: 100%;">Fechar</button>
      </div>
    </div>
  `;
  openModal("Detalhes do Abastecimento", html);
  document.getElementById("btnCloseDetails").addEventListener("click", closeModal);
}

// ==========================================
// PAINEL DO ADMINISTRADOR
// ==========================================
async function renderizarPainelAdmin() {
  adminPanel.innerHTML = `
    <div class="panel-title">
      <h2>Painel de Gestão Rural</h2>
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
        <span>Entregas Mês</span>
        <b id="statEntregas">--</b>
      </div>
      <div class="stat">
        <span>Litros Distribuídos</span>
        <b id="statLitros">--</b>
      </div>
    </div>

    <div class="panel-title" style="margin-top: 24px;">
      <h2>Abastecimentos Agendados e Realizados</h2>
    </div>
    <div id="listaAdminEntregas" class="grid">
      <p class="small">Buscando abastecimentos...</p>
    </div>
  `;

  document.getElementById("btnNovoImovel").addEventListener("click", abrirModalCadastroImovel);
  document.getElementById("btnAgendar").addEventListener("click", abrirModalAgendamento);

  await carregarMetricasAdmin();
  await carregarListaAdminEntregas();
}

async function carregarMetricasAdmin() {
  try {
    const snapFamilias = await getDocs(collection(db, "households"));
    document.getElementById("statFamilias").textContent = snapFamilias.size;

    const snapEntregas = await getDocs(collection(db, "deliveries"));
    document.getElementById("statEntregas").textContent = snapEntregas.size;

    let totalLitros = 0;
    snapEntregas.forEach((d) => {
      const data = d.data();
      if (data.receivedLiters) {
        totalLitros += Number(data.receivedLiters);
      }
    });

    document.getElementById("statLitros").textContent = totalLitros.toLocaleString("pt-BR");
  } catch (e) {
    console.error("Erro nas estatísticas:", e);
  }
}

async function carregarListaAdminEntregas() {
  const container = document.getElementById("listaAdminEntregas");
  if (!container) return;

  try {
    const snap = await getDocs(collection(db, "deliveries"));
    if (snap.empty) {
      container.innerHTML = `<div class="item"><p>Nenhum abastecimento cadastrado.</p></div>`;
      return;
    }

    container.innerHTML = "";
    snap.forEach((d) => {
      const item = d.data();
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="row">
          <h3>${item.recipientName || "Família"}</h3>
          <span class="pill ${item.status === "completed" ? "completed" : "scheduled"}">
            ${item.status === "completed" ? "Concluído" : "Agendado"}
          </span>
        </div>
        <p><strong>Comunidade:</strong> ${item.community}</p>
        <p><strong>Motorista:</strong> ${item.driverName || "Não atribuído"}</p>
        <p><strong>Volume:</strong> ${item.plannedLiters} L</p>
        <div class="actions" style="margin-top: 12px;">
          <button class="secondary" data-id="${d.id}">Ver Ficha Completa</button>
        </div>
      `;
      el.querySelector("button").addEventListener("click", () => abrirDetalhesEntrega(d.id, item));
      container.appendChild(el);
    });
  } catch (err) {
    console.error("Erro ao carregar lista admin:", err);
    container.innerHTML = `<p class="message">Erro ao carregar abastecimentos.</p>`;
  }
}

function abrirModalCadastroImovel() {
  const html = `
    <form id="formCadastroImovel">
      <label>
        Nome do Titular
        <input id="hName" type="text" placeholder="Nome completo" required>
      </label>

      <label>
        CPF
        <input id="hCpf" type="text" placeholder="000.000.000-00" required>
      </label>

      <label>
        Telefone / WhatsApp
        <input id="hPhone" type="tel" placeholder="(84) 99999-9999" required>
      </label>

      <label>
        Comunidade / Assentamento
        <input id="hCommunity" type="text" placeholder="Ex: Ponta do Mel, Redonda, Serra Vermelha..." required>
      </label>

      <label>
        Endereço / Referência
        <input id="hAddress" type="text" placeholder="Perto da capela, casa amarela...">
      </label>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <label>
          Pessoas na Casa
          <input id="hPeople" type="number" min="1" value="4" required>
        </label>
        <label>
          Volume Padrão (L)
          <input id="hLiters" type="number" step="500" value="5000" required>
        </label>
      </div>

      <div class="actions" style="margin-top: 16px;">
        <button type="submit" class="primary" style="flex: 2;">Cadastrar Imóvel</button>
        <button type="button" class="secondary" id="btnCancelH" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openModal("Cadastrar Família / Imóvel", html);
  document.getElementById("btnCancelH").addEventListener("click", closeModal);

  document.getElementById("formCadastroImovel").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type='submit']");
    btn.disabled = true;
    btn.textContent = "Gravando...";

    try {
      await addDoc(collection(db, "households"), {
        name: document.getElementById("hName").value.trim(),
        cpf: document.getElementById("hCpf").value.trim(),
        phone: document.getElementById("hPhone").value.trim(),
        community: document.getElementById("hCommunity").value.trim(),
        address: document.getElementById("hAddress").value.trim(),
        people: Number(document.getElementById("hPeople").value),
        defaultLiters: Number(document.getElementById("hLiters").value),
        active: true,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });

      showToast("Família cadastrada com sucesso!");
      closeModal();
      carregarMetricasAdmin();
    } catch (err) {
      console.error("Erro ao cadastrar família:", err);
      alert("Erro ao salvar cadastro.");
      btn.disabled = false;
      btn.textContent = "Cadastrar Imóvel";
    }
  });
}

async function abrirModalAgendamento() {
  const html = `
    <form id="formAgendamento">
      <label>
        Selecione o Imóvel
        <select id="agHousehold" required>
          <option value="">Carregando imóveis...</option>
        </select>
      </label>

      <label>
        Data Programada
        <input id="agDate" type="date" required>
      </label>

      <label>
        Volume a Entregar (Litros)
        <input id="agLiters" type="number" step="500" value="5000" required>
      </label>

      <div class="actions" style="margin-top: 16px;">
        <button type="submit" class="primary" style="flex: 2;">Confirmar Agendamento</button>
        <button type="button" class="secondary" id="btnCancelAg" style="flex: 1;">Voltar</button>
      </div>
    </form>
  `;

  openModal("Programar Entrega de Água", html);
  document.getElementById("btnCancelAg").addEventListener("click", closeModal);

  const select = document.getElementById("agHousehold");
  let householdsList = [];

  try {
    const snap = await getDocs(collection(db, "households"));
    select.innerHTML = '<option value="">Selecione uma família...</option>';
    snap.forEach((docSnap) => {
      const h = docSnap.data();
      householdsList.push({ id: docSnap.id, ...h });
      const opt = document.createElement("option");
      opt.value = docSnap.id;
      opt.textContent = `${h.name} (${h.community})`;
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = '<option value="">Erro ao carregar lista</option>';
  }

  select.addEventListener("change", () => {
    const selected = householdsList.find((item) => item.id === select.value);
    if (selected && selected.defaultLiters) {
      document.getElementById("agLiters").value = selected.defaultLiters;
    }
  });

  document.getElementById("formAgendamento").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type='submit']");
    btn.disabled = true;
    btn.textContent = "Agendando...";

    const hId = select.value;
    const selectedH = householdsList.find((item) => item.id === hId);

    try {
      await addDoc(collection(db, "deliveries"), {
        householdId: hId,
        recipientName: selectedH ? selectedH.name : "Beneficiário",
        recipientPhone: selectedH ? selectedH.phone : "",
        address: selectedH ? selectedH.address : "",
        community: selectedH ? selectedH.community : "",
        scheduledDate: document.getElementById("agDate").value,
        plannedLiters: Number(document.getElementById("agLiters").value),
        driverUid: currentUser.uid,
        driverName: currentUserProfile.name || "Motorista Pipa",
        status: "scheduled",
        createdAt: serverTimestamp()
      });

      showToast("Abastecimento agendado com sucesso!");
      closeModal();
      carregarMetricasAdmin();
      carregarListaAdminEntregas();
    } catch (err) {
      console.error("Erro no agendamento:", err);
      alert("Não foi possível programar o abastecimento.");
      btn.disabled = false;
      btn.textContent = "Confirmar Agendamento";
    }
  });
}

// ==========================================
// PAINEL DO BENEFICIÁRIO
// ==========================================
async function renderizarPainelBeneficiario() {
  recipientPanel.innerHTML = `
    <div class="panel-title">
      <h2>Meus Abastecimentos</h2>
      <button id="btnAtualizarRec" class="secondary" type="button">Atualizar</button>
    </div>
    <div id="listaBeneficiario" class="grid">
      <p class="small">Buscando seu histórico...</p>
    </div>
  `;

  document.getElementById("btnAtualizarRec").addEventListener("click", carregarHistoricoBeneficiario);
  await carregarHistoricoBeneficiario();
}

async function carregarHistoricoBeneficiario() {
  const container = document.getElementById("listaBeneficiario");
  if (!container) return;

  try {
    const q = query(
      collection(db, "deliveries"),
      where("recipientPhone", "==", currentUserProfile.phone || "")
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="item">
          <p>Nenhum abastecimento encontrado para o seu contato.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    snap.forEach((d) => {
      const item = d.data();
      const card = document.createElement("div");
      card.className = "item";
      card.innerHTML = `
        <div class="row">
          <h3>Entrega de Água</h3>
          <span class="pill ${item.status === "completed" ? "completed" : "scheduled"}">
            ${item.status === "completed" ? "Entregue" : "Programado"}
          </span>
        </div>
        <p><strong>Data Prevista:</strong> ${item.scheduledDate || "Em breve"}</p>
        <p><strong>Volume:</strong> ${item.plannedLiters} Litros</p>
        <p><strong>Caminhão / Motorista:</strong> ${item.driverName || "Em rota"}</p>
        ${
          item.status === "completed"
            ? `<div class="actions" style="margin-top: 10px;"><button class="secondary" data-id="${d.id}">Ver Comprovante</button></div>`
            : ""
        }
      `;
      const btn = card.querySelector("button");
      if (btn) {
        btn.addEventListener("click", () => abrirDetalhesEntrega(d.id, item));
      }
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Erro beneficiário:", err);
    container.innerHTML = `<p class="message">Erro ao carregar informações.</p>`;
  }
}

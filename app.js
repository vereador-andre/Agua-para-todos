import {
  auth,
  db,
  storage
} from "./firebase-config.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const $ = (id) => document.getElementById(id);
const state = { user:null, profile:null, households:[], deliveries:[] };

$("logoutBtn").onclick = () => signOut(auth);
$("closeModal").onclick = closeModal;
$("modal").onclick = e => { if(e.target.id==="modal") closeModal(); };

function toast(msg){ $("toast").textContent=msg; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),3500); }
function openModal(html){ $("modalContent").innerHTML=html; $("modal").classList.remove("hidden"); }
function closeModal(){ $("modal").classList.add("hidden"); $("modalContent").innerHTML=""; }
function esc(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function fmtDate(ts){ if(!ts) return "—"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleString("pt-BR"); }
function dateOnly(v){ return new Date(v+"T12:00:00").toLocaleDateString("pt-BR"); }

$("loginForm").onsubmit = async e=>{
  e.preventDefault(); $("loginMsg").textContent="";
  try{ await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value); }
  catch(err){ $("loginMsg").textContent = friendlyAuthError(err); }
};
function friendlyAuthError(err){
  const m = {
    "auth/invalid-credential":"E-mail ou senha inválidos.",
    "auth/user-not-found":"Usuário não encontrado.",
    "auth/wrong-password":"Senha incorreta.",
    "auth/too-many-requests":"Muitas tentativas. Aguarde alguns minutos."
  };
  return m[err.code] || "Não foi possível entrar. Verifique os dados.";
}

onAuthStateChanged(auth, async user=>{
  if(!user){
    state.user=null; $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); $("logoutBtn").classList.add("hidden"); return;
  }
  state.user=user; $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("logoutBtn").classList.remove("hidden");
  $("connectionStatus").textContent="Online"; $("connectionStatus").classList.add("ok");
  try{
    const p=await getDoc(doc(db,"users",user.uid));
    if(!p.exists()){ toast("Usuário autenticado, mas sem perfil cadastrado."); return; }
    state.profile={id:p.id,...p.data()};
    $("userName").textContent=state.profile.name||user.email;
    $("userRole").textContent=roleLabel(state.profile.role);
    await renderByRole();
  }catch(e){ console.error(e); toast("Erro ao carregar seu perfil."); }
});
function roleLabel(r){return ({admin:"Administrador",driver:"Motorista",recipient:"Beneficiário"})[r]||r||"Usuário"}

async function renderByRole(){
  ["adminPanel","driverPanel","recipientPanel"].forEach(id=>$(id).classList.add("hidden"));
  if(state.profile.role==="admin"){ $("adminPanel").classList.remove("hidden"); await renderAdmin(); }
  if(state.profile.role==="driver"){ $("driverPanel").classList.remove("hidden"); await renderDriver(); }
  if(state.profile.role==="recipient"){ $("recipientPanel").classList.remove("hidden"); await renderRecipient(); }
}

/* ADMIN */
async function renderAdmin(){
  const hs=await getDocs(query(collection(db,"households"),orderBy("name")));
  state.households=hs.docs.map(d=>({id:d.id,...d.data()}));
  const ds=await getDocs(query(collection(db,"deliveries"),orderBy("scheduledDate","desc"),limit(100)));
  state.deliveries=ds.docs.map(d=>({id:d.id,...d.data()}));
  const pending=state.deliveries.filter(x=>x.status==="scheduled").length;
  const done=state.deliveries.filter(x=>x.status==="completed").length;
  $("adminPanel").innerHTML=`
    <div class="card">
      <div class="panel-title"><h2>Painel administrativo</h2><div class="actions">
        <button class="primary" id="newHousehold">+ Cadastrar família</button>
        <button class="yellow" id="newDelivery">+ Programar entrega</button>
      </div></div>
      <div class="stats">
        <div class="stat"><b>${state.households.length}</b> famílias</div>
        <div class="stat"><b>${pending}</b> programadas</div>
        <div class="stat"><b>${done}</b> concluídas</div>
      </div>
    </div>
    <div class="card"><div class="panel-title"><h2>Últimas entregas</h2></div>
      <div class="grid">${state.deliveries.slice(0,30).map(deliveryCard).join("")||"<p class='small'>Nenhuma entrega registrada.</p>"}</div>
    </div>
  `;
  $("newHousehold").onclick=showHouseholdForm;
  $("newDelivery").onclick=showDeliveryForm;
}
function deliveryCard(d){
  return `<div class="item"><div class="row"><h3>${esc(d.recipientName||"Beneficiário")}</h3><span class="pill ${esc(d.status)}">${statusLabel(d.status)}</span></div>
  <p><b>Data:</b> ${esc(d.scheduledDate||"—")} · <b>Quantidade:</b> ${esc(d.plannedLiters||"—")} L</p>
  <p><b>Local:</b> ${esc(d.address||"—")} · <b>Motorista:</b> ${esc(d.driverName||"—")}</p>
  ${d.completedAt?`<p><b>Concluída:</b> ${fmtDate(d.completedAt)} · <b>Recebido:</b> ${esc(d.receivedLiters||"—")} L</p>`:""}
  </div>`
}
function statusLabel(s){return ({scheduled:"Programada",completed:"Concluída",absent:"Ninguém no local",cancelled:"Cancelada"})[s]||s||"—"}

function showHouseholdForm(){
  openModal(`<h2>Nova família / imóvel</h2>
  <form id="householdForm">
    <label>Nome do responsável<input id="hName" required></label>
    <label>CPF (opcional)<input id="hCpf" inputmode="numeric"></label>
    <label>Telefone<input id="hPhone" required></label>
    <label>Comunidade / zona rural<input id="hCommunity" required></label>
    <label>Endereço / referência<input id="hAddress" required></label>
    <label>Quantidade de pessoas<input id="hPeople" type="number" min="1" required></label>
    <label>Frequência<select id="hFreq"><option>Semanal</option><option>Quinzenal</option><option>Mensal</option><option>Conforme necessidade</option></select></label>
    <label>Litros programados por entrega<input id="hLiters" type="number" min="1" required></label>
    <button class="primary">Salvar família</button>
  </form>`);
  $("householdForm").onsubmit=async e=>{
    e.preventDefault();
    await addDoc(collection(db,"households"),{
      name:$("hName").value.trim(),cpf:$("hCpf").value.trim(),phone:$("hPhone").value.trim(),
      community:$("hCommunity").value.trim(),address:$("hAddress").value.trim(),
      people:Number($("hPeople").value),frequency:$("hFreq").value,defaultLiters:Number($("hLiters").value),
      active:true,createdAt:serverTimestamp(),createdBy:state.user.uid
    });
    closeModal(); toast("Família cadastrada."); await renderAdmin();
  };
}
async function showDeliveryForm(){
  if(!state.households.length){toast("Cadastre uma família primeiro.");return}
  openModal(`<h2>Programar entrega</h2><form id="deliveryForm">
    <label>Família<select id="dHousehold">${state.households.filter(h=>h.active!==false).map(h=>`<option value="${h.id}">${esc(h.name)} — ${esc(h.community)}</option>`).join("")}</select></label>
    <label>Data<input id="dDate" type="date" required></label>
    <label>Quantidade planejada (litros)<input id="dLiters" type="number" min="1" required></label>
    <label>Motorista (UID do usuário)<input id="dDriverUid" placeholder="Cole o UID do motorista" required></label>
    <label>Observação<textarea id="dNote"></textarea></label>
    <button class="primary">Programar entrega</button></form>`);
  $("dHousehold").onchange=()=>{const h=state.households.find(x=>x.id===$("dHousehold").value);$("dLiters").value=h?.defaultLiters||""};
  $("dHousehold").dispatchEvent(new Event("change"));
  $("deliveryForm").onsubmit=async e=>{
    e.preventDefault(); const h=state.households.find(x=>x.id===$("dHousehold").value);
    const du=await getDoc(doc(db,"users",$("dDriverUid").value.trim()));
    if(!du.exists()||du.data().role!=="driver"){toast("UID do motorista inválido ou sem perfil de motorista.");return}
    await addDoc(collection(db,"deliveries"),{
      householdId:h.id,recipientName:h.name,address:h.address,community:h.community,
      recipientPhone:h.phone,scheduledDate:$("dDate").value,plannedLiters:Number($("dLiters").value),
      driverUid:$("dDriverUid").value.trim(),driverName:du.data().name||"Motorista",note:$("dNote").value.trim(),
      status:"scheduled",createdAt:serverTimestamp(),createdBy:state.user.uid
    });
    closeModal();toast("Entrega programada.");await renderAdmin();
  };
}

/* DRIVER */
async function renderDriver(){
  const q=query(collection(db,"deliveries"),where("driverUid","==",state.user.uid),orderBy("scheduledDate","asc"),limit(100));
  const ds=await getDocs(q); state.deliveries=ds.docs.map(d=>({id:d.id,...d.data()}));
  $("driverPanel").innerHTML=`<div class="card"><div class="panel-title"><h2>Minhas entregas</h2></div>
    <div class="notice">Ao concluir, o registro recebe data/hora do servidor. O motorista informa a quantidade real, e o beneficiário confirma por assinatura. Se ninguém estiver no local, deve haver foto.</div>
    <div class="grid" style="margin-top:14px">${state.deliveries.map(driverCard).join("")||"<p class='small'>Nenhuma entrega atribuída.</p>"}</div>
  </div>`;
  document.querySelectorAll("[data-complete]").forEach(b=>b.onclick=()=>showCompleteForm(b.dataset.complete));
}
function driverCard(d){
  const action=d.status==="scheduled"?`<button class="primary" data-complete="${d.id}">Registrar entrega</button>`:"";
  return `<div class="item"><div class="row"><h3>${esc(d.recipientName)}</h3><span class="pill ${esc(d.status)}">${statusLabel(d.status)}</span></div>
  <p><b>Quando:</b> ${esc(d.scheduledDate)} · <b>Planejado:</b> ${esc(d.plannedLiters)} L</p>
  <p><b>Comunidade:</b> ${esc(d.community)}<br><b>Endereço:</b> ${esc(d.address)}</p>${action}</div>`;
}

function showCompleteForm(id){
  const d=state.deliveries.find(x=>x.id===id);
  openModal(`<h2>Registrar fornecimento</h2>
  <div class="notice">O valor informado aqui é o que efetivamente foi colocado no imóvel. Não finalize sem conferir a quantidade.</div>
  <form id="completeForm">
    <label>Quantidade realmente entregue (litros)<input id="cLiters" type="number" min="1" value="${esc(d.plannedLiters)}" required></label>
    <label>Havia alguém no local?<select id="cPresence"><option value="yes">Sim — beneficiário presente</option><option value="no">Não — ninguém no local</option></select></label>
    <div id="recipientFields">
      <label>PIN de confirmação do beneficiário<input id="cPin" inputmode="numeric" maxlength="8" placeholder="PIN fornecido ao beneficiário"></label>
      <label>Assinatura do beneficiário</label>
      <canvas id="signature" class="signature"></canvas>
      <div class="actions"><button type="button" class="secondary" id="clearSig">Limpar assinatura</button></div>
    </div>
    <div id="photoFields" class="hidden">
      <label>Foto de prova (obrigatória se ninguém estiver)<input id="cPhoto" type="file" accept="image/*" capture="environment"></label>
      <p class="small">Prefira tirar a foto no momento da entrega, mostrando o ponto de abastecimento.</p>
    </div>
    <label>Observação<textarea id="cNote"></textarea></label>
    <button class="primary">Finalizar fornecimento</button>
  </form>`);
  const canvas=$("signature"),ctx=canvas.getContext("2d"); let drawing=false;
  function resize(){const r=canvas.getBoundingClientRect();canvas.width=r.width*devicePixelRatio;canvas.height=r.height*devicePixelRatio;ctx.scale(devicePixelRatio,devicePixelRatio);ctx.lineWidth=2;ctx.lineCap="round";ctx.strokeStyle="#172033"}
  resize(); window.addEventListener("resize",resize,{once:true});
  function pos(e){const r=canvas.getBoundingClientRect(),p=e.touches?e.touches[0]:e;return [p.clientX-r.left,p.clientY-r.top]}
  const start=e=>{drawing=true;const [x,y]=pos(e);ctx.beginPath();ctx.moveTo(x,y);e.preventDefault()};
  const move=e=>{if(!drawing)return;const [x,y]=pos(e);ctx.lineTo(x,y);ctx.stroke();e.preventDefault()};
  const end=()=>drawing=false;
  canvas.addEventListener("mousedown",start);canvas.addEventListener("mousemove",move);canvas.addEventListener("mouseup",end);
  canvas.addEventListener("touchstart",start,{passive:false});canvas.addEventListener("touchmove",move,{passive:false});canvas.addEventListener("touchend",end);
  $("clearSig").onclick=()=>ctx.clearRect(0,0,canvas.width,canvas.height);
  $("cPresence").onchange=()=>{const yes=$("cPresence").value==="yes";$("recipientFields").classList.toggle("hidden",!yes);$("photoFields").classList.toggle("hidden",yes)};
  $("completeForm").onsubmit=async e=>{
    e.preventDefault();
    const present=$("cPresence").value==="yes";
    if(present && $("cPin").value.trim()!==String(d.confirmationPin||"")){toast("PIN de confirmação incorreto.");return}
    if(present && isBlankCanvas(canvas)){toast("Faça a assinatura do beneficiário.");return}
    if(!present && !$("cPhoto").files[0]){toast("A foto é obrigatória quando não há ninguém no local.");return}
    let photoUrl=null, signatureData=null;
    if(present) signatureData=canvas.toDataURL("image/png");
    else {
      const file=$("cPhoto").files[0];
      const path=`delivery-proof/${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const snap=await uploadBytes(ref(storage,path),file,{contentType:file.type});
      photoUrl=await getDownloadURL(snap.ref);
    }
    await updateDoc(doc(db,"deliveries",id),{
      status:present?"completed":"absent",receivedLiters:Number($("cLiters").value),
      recipientPresent:present,signatureData,photoUrl,note:$("cNote").value.trim(),
      completedAt:serverTimestamp(),completedBy:state.user.uid
    });
    closeModal();toast("Fornecimento registrado.");await renderDriver();
  };
}
function isBlankCanvas(c){const data=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=3;i<data.length;i+=4)if(data[i]>0)return false;return true}

/* RECIPIENT */
async function renderRecipient(){
  const q=query(collection(db,"deliveries"),where("recipientPhone","==",state.profile.phone||""),orderBy("scheduledDate","desc"),limit(50));
  let ds=await getDocs(q).catch(()=>({docs:[]}));
  const list=ds.docs.map(d=>({id:d.id,...d.data()}));
  $("recipientPanel").innerHTML=`<div class="card"><div class="panel-title"><h2>Meu abastecimento</h2></div>
    <div class="notice">Confira data, quantidade e situação de cada fornecimento. Se houver divergência, procure a administração com o número da entrega.</div>
    <div class="grid" style="margin-top:14px">${list.map(recipientCard).join("")||"<p class='small'>Nenhum fornecimento localizado.</p>"}</div>
  </div>`;
}
function recipientCard(d){
  return `<div class="item"><div class="row"><h3>${esc(d.scheduledDate)}</h3><span class="pill ${esc(d.status)}">${statusLabel(d.status)}</span></div>
  <p><b>Quantidade programada:</b> ${esc(d.plannedLiters)} L</p>
  <p><b>Quantidade registrada:</b> ${esc(d.receivedLiters||"Ainda não registrada")} ${d.receivedLiters?"L":""}</p>
  <p><b>Local:</b> ${esc(d.address)}</p></div>`;
}

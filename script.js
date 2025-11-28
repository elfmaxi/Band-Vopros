const API_BASE = "/api";
let userId = localStorage.getItem("bv_user_id");
if (!userId) {
  userId = "u_" + Math.random().toString(36).slice(2,10);
  localStorage.setItem("bv_user_id", userId);
}

const qtext = document.getElementById("qtext");
const askBtn = document.getElementById("askBtn");
const list = document.getElementById("list");

askBtn.addEventListener("click", postQuestion);
qtext.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey||e.metaKey)) postQuestion(); });

async function fetchJSON(url, opts){
  const res = await fetch(url, opts);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

async function load(){
  try{
    const data = await fetchJSON(`${API_BASE}/questions`);
    renderList(data.questions || data);
  }catch(e){
    console.error(e);
    list.innerHTML = '<div class="small">Не удалось загрузить вопросы</div>';
  }
}

function escapeText(s){
  const d = document.createTextNode(s);
  const span = document.createElement("span");
  span.appendChild(d);
  return span.innerHTML;
}

function renderList(questions){
  list.innerHTML = "";
  if(!questions.length){ list.innerHTML = '<div class="small">Пока нет вопросов — будь первым</div>'; return; }
  questions.forEach(q => {
    const card = document.createElement("div");
    card.className = "card";
    const txt = document.createElement("div");
    txt.innerHTML = `<div>${escapeText(q.text)}</div>`;
    card.appendChild(txt);

    const meta = document.createElement("div");
    meta.className = "meta";
    const likeBtn = document.createElement("button");
    likeBtn.className = "btn like";
    if(q.likedBy && q.likedBy.includes(userId)) likeBtn.classList.add("liked");
    likeBtn.innerText = `❤ ${q.likes||0}`;
    likeBtn.onclick = () => toggleLike(q.id, likeBtn);
    meta.appendChild(likeBtn);

    const replyBtn = document.createElement("button");
    replyBtn.className = "btn";
    replyBtn.innerText = "Ответить";
    meta.appendChild(replyBtn);

    card.appendChild(meta);

    const answerArea = document.createElement("div");
    answerArea.style.display = "none";
    answerArea.className = "answer-area";

    const ansRow = document.createElement("div");
    ansRow.className = "answer-row";
    const ansInput = document.createElement("input");
    ansInput.className = "ans-input";
    ansInput.placeholder = "Ваш ответ...";
    const sendBtn = document.createElement("button");
    sendBtn.className = "btn";
    sendBtn.innerText = "Отправить";
    sendBtn.onclick = () => postAnswer(q.id, ansInput);

    ansRow.appendChild(ansInput);
    ansRow.appendChild(sendBtn);
    answerArea.appendChild(ansRow);
    card.appendChild(answerArea);

    replyBtn.onclick = () => {
      answerArea.style.display = answerArea.style.display === "none" ? "block" : "none";
    };

    // answers list
    const answersWrap = document.createElement("div");
    answersWrap.className = "answers";
    (q.answers || []).forEach(a => {
      const aDiv = document.createElement("div");
      aDiv.innerHTML = `<div>${escapeText(a.text)}</div><div class="small">${new Date(a.createdAt||0).toLocaleString()}</div>`;
      answersWrap.appendChild(aDiv);
    });
    card.appendChild(answersWrap);

    list.appendChild(card);
  });
}

async function postQuestion(){
  const text = qtext.value.trim();
  if(!text) return;
  try{
    await fetchJSON(`${API_BASE}/questions`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ text })
    });
    qtext.value = "";
    load();
  }catch(e){
    alert("Ошибка создания вопроса");
    console.error(e);
  }
}

async function postAnswer(id, inputEl){
  const text = inputEl.value.trim();
  if(!text) return;
  try{
    await fetchJSON(`${API_BASE}/questions/${id}/answers`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ text })
    });
    inputEl.value = "";
    load();
  }catch(e){
    alert("Ошибка отправки ответа");
    console.error(e);
  }
}

async function toggleLike(id, btn){
  try{
    const res = await fetchJSON(`${API_BASE}/questions/${id}/toggle-like`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ userId })
    });
    // update button text
    btn.innerText = `❤ ${res.likes}`;
    btn.classList.toggle("liked");
    load();
  }catch(e){
    console.error(e);
  }
}

// initial load
load();

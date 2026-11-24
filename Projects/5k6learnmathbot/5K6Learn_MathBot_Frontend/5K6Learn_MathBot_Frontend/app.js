const API_BASE = "http://127.0.0.1:8000"; // Change this if your backend is hosted online.
const $ = (id) => document.getElementById(id);
let mode = "simplify";
const modeInfo = {
 simplify:["SYMBOLIC MATHS","Simplify an expression","Your expression","e.g. (x + 2)^2 - x^2"],
 solve:["EQUATION SOLVER","Solve an equation","Equation","e.g. 2*x + 5 = 15"],
 factor:["ALGEBRA","Factor an expression","Your expression","e.g. x^2 - 5*x + 6"],
 expand:["ALGEBRA","Expand an expression","Your expression","e.g. (x + 2)^3"],
 differentiate:["CALCULUS","Find a derivative","Function","e.g. x^3 + sin(x)"],
 integrate:["CALCULUS","Find an integral","Function","e.g. 3*x^2 + cos(x)"],
 limit:["CALCULUS","Evaluate a limit","Function","e.g. sin(x)/x"],
 evaluate:["CALCULATOR","Calculate a value","Expression","e.g. sqrt(81) + 4^2"],
 graph:["FUNCTION GRAPHS","Graph a function","Function of x","e.g. x^2 - 4"],
 matrix:["LINEAR ALGEBRA","Matrix tools","Matrix A (JSON rows)","e.g. [[1,2],[3,4]]"],
 word:["AI MATHS TUTOR","Explain a word problem","Describe the word problem","e.g. A number plus 5 equals 12. Find the number."]
};
function setMode(next) {
 mode = next;
 document.querySelectorAll(".mode").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
 const info=modeInfo[mode];
 $("modeEyebrow").textContent=info[0]; $("panelTitle").textContent=info[1];
 $("inputLabel").textContent=info[2]; $("expression").placeholder=info[3];
 $("expression").value="";
 $("extraFields").innerHTML="";
 if(mode==="limit") $("extraFields").innerHTML='<div style="margin:12px 0"><label for="approach">Approach value (x → ?)</label><input id="approach" value="0" class="extra-input"></div>';
 if(mode==="matrix") $("extraFields").innerHTML='<div style="margin-top:12px"><label for="matrixB">Optional matrix B for A + B (JSON rows)</label><input id="matrixB" placeholder="e.g. [[5,6],[7,8]]" class="extra-input"></div>';
 if(mode==="word") $("expression").rows=4; else $("expression").rows=2;
 $("resultBox").classList.add("hidden"); $("errorBox").classList.add("hidden");
}
document.querySelectorAll(".mode").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
document.querySelectorAll(".example").forEach(b=>b.addEventListener("click",()=>{$("expression").value=b.dataset.value;$("expression").focus();}));
$("clearBtn").addEventListener("click",()=>{ $("expression").value=""; $("resultBox").classList.add("hidden"); $("errorBox").classList.add("hidden"); });
$("copyBtn").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("resultText").textContent);$("copyBtn").textContent="Copied!";setTimeout(()=>$("copyBtn").textContent="Copy answer",1200)}catch{$("copyBtn").textContent="Select to copy"}});
$("solveBtn").addEventListener("click",solve);
$("expression").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();solve();}});
async function solve(){
 const button=$("solveBtn"); const expression=$("expression").value.trim();
 $("errorBox").classList.add("hidden"); $("resultBox").classList.add("hidden");
 if(!expression){showError("Enter a mathematical expression first.");return;}
 const payload={mode,expression,variable:$("variable").value};
 if(mode==="limit")payload.second_expression=$("approach")?.value||"0";
 if(mode==="word"){payload.word_problem=expression;payload.expression="";}
 if(mode==="matrix"){
  try{payload.matrix_a=JSON.parse(expression);const b=$("matrixB")?.value.trim();if(b)payload.matrix_b=JSON.parse(b);payload.expression="";}
  catch{showError("Enter matrix rows as valid JSON, for example [[1,2],[3,4]].");return;}
 }
 button.disabled=true;button.innerHTML="Working…";
 try{
  const res=await fetch(`${API_BASE}/api/solve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await res.json();
  if(!res.ok)throw new Error(data.detail||"Server error.");
  if(!data.ok){showError(data.error||"Could not solve this input.");return;}
  $("resultTitle").textContent=data.title||"Solution";
  $("resultText").textContent=typeof data.result==="string"?data.result:JSON.stringify(data.result,null,2);
  $("stepsList").innerHTML="";
  (data.steps||[]).forEach(step=>{const li=document.createElement("li");li.textContent=step;$("stepsList").appendChild(li);});
  if(data.ai_explanation||data.ai_used){$("aiBox").classList.remove("hidden");$("aiText").textContent=data.ai_explanation||data.result;}else{$("aiBox").classList.add("hidden");}
  if(data.points){$("graphWrap").classList.remove("hidden");drawGraph(data.points);}else{$("graphWrap").classList.add("hidden");}
  $("resultBox").classList.remove("hidden");
 }catch(err){showError("Could not connect to the backend. Start the server with run.bat. Details: "+err.message);}
 finally{button.disabled=false;button.innerHTML='<span>✦</span> Solve it <span class="arrow">→</span>';}
}
function showError(message){$("errorBox").textContent=message;$("errorBox").classList.remove("hidden");}
function drawGraph(points){
 const canvas=$("graphCanvas"),ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height,pad=34;
 ctx.clearRect(0,0,w,h);
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
 const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.max(-20,Math.min(...ys)),ymax=Math.min(20,Math.max(...ys));
 const yrange=(ymax-ymin)||1;
 const X=x=>pad+(x-xmin)/(xmax-xmin)*(w-2*pad),Y=y=>h-pad-(y-ymin)/yrange*(h-2*pad);
 ctx.strokeStyle="#e8e8f2";ctx.lineWidth=1;
 for(let i=0;i<=8;i++){let gx=pad+i*(w-2*pad)/8;ctx.beginPath();ctx.moveTo(gx,pad);ctx.lineTo(gx,h-pad);ctx.stroke();}
 for(let i=0;i<=6;i++){let gy=pad+i*(h-2*pad)/6;ctx.beginPath();ctx.moveTo(pad,gy);ctx.lineTo(w-pad,gy);ctx.stroke();}
 ctx.strokeStyle="#8d92aa";ctx.lineWidth=1.5;
 if(ymin<=0&&ymax>=0){ctx.beginPath();ctx.moveTo(pad,Y(0));ctx.lineTo(w-pad,Y(0));ctx.stroke();}
 if(xmin<=0&&xmax>=0){ctx.beginPath();ctx.moveTo(X(0),pad);ctx.lineTo(X(0),h-pad);ctx.stroke();}
 ctx.strokeStyle="#785de5";ctx.lineWidth=2.5;ctx.beginPath();let started=false,last=null;
 for(const pt of points){if(pt.y<ymin||pt.y>ymax){started=false;last=pt;continue;}const px=X(pt.x),py=Y(pt.y);if(!started||(last&&Math.abs(pt.x-last.x)>0.2)){ctx.moveTo(px,py);started=true;}else ctx.lineTo(px,py);last=pt;}
 ctx.stroke();ctx.fillStyle="#727a93";ctx.font="12px sans-serif";ctx.fillText("x",w-pad+8,Y(0)-6);ctx.fillText("y",X(0)+7,pad-10);
}
fetch(`${API_BASE}/api/health`).then(r=>r.json()).then(d=>{$("apiStatus").textContent=d.ai_enabled?"Math engine + AI connected":"Math engine ready · AI optional"}).catch(()=>$("apiStatus").textContent="Backend not connected");

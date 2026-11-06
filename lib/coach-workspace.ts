import {coachPage} from './protected-page';

export const coachEmbed=(request:Request)=>new URL(request.url).searchParams.get('embed')==='coach';

export function coachPanelMarkup(html:string){
 return html.replace('</head>','<link rel="stylesheet" href="/coach-panel.css"></head>')
  .replace('<body>','<body class="coach-embedded">');
}

export function allowCoachPanel(headers:Headers){
 headers.set('X-Frame-Options','SAMEORIGIN');
 headers.set('Content-Security-Policy',"frame-ancestors 'self'");
}

export async function coachToolPage(request:Request,html:string){
 const embedded=coachEmbed(request);
 const response=await coachPage(request,embedded?coachPanelMarkup(html):html);
 if(embedded&&response.status===200)allowCoachPanel(response.headers);
 return response;
}

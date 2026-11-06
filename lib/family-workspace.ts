import {allowSameOriginPanel} from './protected-page';

export function familyToolPanel(request:Request,html:string,auth:Response){
 if(auth.status!==200)return auth;
 if(new URL(request.url).searchParams.get('embed')==='family'){
  allowSameOriginPanel(auth.headers);
  html=html.replace('</head>','<link rel="stylesheet" href="/family-panel.css"></head>')
   .replace('<body>','<body class="family-embedded">');
 }
 return new Response(html,{headers:auth.headers});
}

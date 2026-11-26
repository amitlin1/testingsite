<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
  <#if section = "form">
    <div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;padding:8px 0 4px">
      <div style="width:54px;height:54px;border-radius:9999px;background:rgba(217,119,6,0.1);display:flex;align-items:center;justify-content:center">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      </div>
      <div>
        <h1 class="sh-title" style="margin:0 0 8px;font-size:22px">${msg("pageExpiredTitle")}</h1>
        <p class="sh-sub" style="margin:0">${msg("pageExpiredMsg1")}</p>
      </div>
      <a class="sh-btn" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${url.loginRestartFlowUrl}">${msg("doRestartLogin")}</a>
    </div>
  </#if>
</@layout.registrationLayout>

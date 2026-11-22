'use strict';
  /* ---------- التوجيه ---------- */

  function currentTeacher() {
    if (!S.ready || !isStaff()) return null;
    var m = location.hash.match(/^#\/t\/(.+)$/);
    return m ? find(m[1]) : null;
  }

  function render() {
    document.getElementById('page-lh').innerHTML = letterhead();
    document.getElementById('page-css').textContent = pageCss() + '@media print{' + sheetPadCss('body.print-sheet ') +
      '#content{padding:' + REPORT.page.marginY + 'mm ' + REPORT.page.marginX + 'mm}}';
    renderSide();
    if (!sb) return renderSetup();
    if (!S.uid) return renderAuth();
    if (!S.ready) { app.innerHTML = '<div class="card empty">جارٍ التحميل…</div>'; return; }
    // دخول شاشة ممنوحة أو الخروج منها: تُحمَّل البيانات من جديد بالصلاحية المناسبة
    if (S.baseProfile && permAreaFor(location.hash) !== ACT_AREA) { loadAll(); return; }
    if (role() === 'pending') return renderPending();
    if (S.profile && S.profile.must_change_password) return renderChangePw();
    if (location.hash === '#/mine' && S.myStaff) return renderMine();
    if (location.hash === '#/papers' && canPapers()) return renderPapers();
    if (location.hash === '#/thome' && isTeacherRole()) return renderTeacherHome();
    if (isTeacherRole() && (location.hash === '' || location.hash === '#') && !ui.thomeSeen) { ui.thomeSeen = true; return go('#/thome'); }
    if (location.hash === '#/mystudents' && isTeacherRole()) return renderMyStudents();
    if (location.hash === '#/grades' && (isTeacherRole() || isAdmin() || isManager())) return renderGrades();
    if (location.hash === '#/gradecfg' && isAdmin()) return renderGradeCfg();
    if (location.hash === '#/signatures') return renderSignatures();

    var h = location.hash;
    var r = h.match(/^#\/r\/(.+)$/);
    if (h === '#/messages' && canRecordAtt()) return renderMessages();
    if (h === '#/exits' && canAttView()) return renderExits();
    if (h === '#/discipline' && canDisc()) return renderDiscipline();
    if (h === '#/custody' && canView()) return renderCustody();
    if (h === '#/orders' && canView()) return renderOrders();
    if (h === '#/claims' && canView()) return renderClaims();
    if (/^#\/affairs/.test(h) && canAttView()) return renderAffairs();
    if (isRegistrar()) {
      if (/^#\/classes/.test(h)) return renderClasses();
      if (h === '#/attendance') return renderAttendance();
      if (h === '#/reports') return renderReports();
      if (/^#\/transport/.test(h)) return renderTransport();
      if (h !== '#/students') return go('#/students');
      return renderStudents();
    }
    if (/^#\/timetable/.test(h) && (isStaff() || isTeacherRole())) return renderTimetable();
    if (!isStaff()) return renderResults(r && r[1]);

    var t = currentTeacher();
    if (t) return renderEval(t);
    var v = currentVisit();
    if (v) return renderVisit(v);
    if (h === '#/visits' || /^#\/v\//.test(h)) return renderVisits();
    if (/^#\/committees/.test(h) && canCm()) return renderCommittees();
    if (h === '#/staff' && canView()) return renderStaff();
    if (h === '#/staff' && isSup()) return renderStaff();
    if (/^#\/classes/.test(h) && isSup()) return renderClasses();
    if (h === '#/payroll' && prLevel()) return renderPayroll();
    if (h === '#/payrun' && prLevel()) return renderPayRun();
    if (h === '#/staffatt' && canView()) return renderStaffAtt();
    if (h === '#/payroll' && prLevel()) return renderPayroll();
    if (h === '#/payrun' && prLevel()) return renderPayRun();
    if (h === '#/students' && canView()) return renderStudents();
    if (/^#\/classes/.test(h) && canView()) return renderClasses();
    if (/^#\/transport/.test(h) && canView()) return renderTransport();
    if (h === '#/admin' && canView()) return renderAdmin();
    if (h === '#/rooms' && canView()) return renderRooms();
    if (h === '#/audit' && isAdmin()) return renderAudit();
    if (h === '#/parents' && isAdmin()) return renderParents();
    if (h === '#/attendance' && canAttView()) return renderAttendance();
    if (h === '#/reports' && canView()) return renderReports();
    if (h === '#/results' || r) return renderResults(r && r[1]);
    if (h === '#/teachers') return renderList();
    renderHome();
  }


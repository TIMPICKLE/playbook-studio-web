// Columns retain the spacing from the personnel sheets. Vertical bands separate
// lines of players and leave room for names; their spacing isn't measured in yards.
const offenseLine = { LT: 5, LG: 6, C: 7, RG: 8, RT: 9 };
const defensiveFront = { WDE: 4, DT: 5, NT: 6, SDE: 7 };
const layouts = {
  spread: [13, [
    [33, { X: 1, Y: 3, ...offenseLine, F: 11, Z: 13 }],
    [78, { QB: 7, H: 9 }],
  ]],
  bunch: [13, [
    [33, { X: 3, ...offenseLine, F: 12 }],
    [53, { Y: 11, Z: 13 }],
    [78, { H: 5, QB: 7 }],
  ]],
  '4-2-5': [10, [
    [18, { FS: 5 }],
    [43, { Mike: 5, Sam: 6 }],
    [62, { WS: 2, SS: 9 }],
    [80, { LCB: 1, ...defensiveFront, RCB: 10 }],
  ]],
  kickoff: [11, [
    [50, { L1: 1, 'L2 Contain': 2, L3: 3, L4: 4, L5: 5, K: 6, R5: 7, R4: 8, R3: 9, 'R2 Contain': 10, R1: 11 }],
  ]],
  'kickoff-return': [11, [
    [21, { LT: 2, LG: 4, C: 6, RG: 8, RT: 10 }],
    [50, { LE: 3, LUB: 5, RUB: 7, RE: 9 }],
    [80, { LR: 4, RR: 8 }],
  ]],
  punt: [11, [
    [19, { X: 1, 'LT Contain': 4, LG: 5, C: 6, RG: 7, 'RT Contain': 8, Z: 11 }],
    [43, { TB: 5, RB: 7 }],
    [63, { PP: 7 }],
    [83, { P: 6 }],
  ]],
  // The return sheet locates the two corners and returner, and calls for the
  // starting defense elsewhere. Carry over the front and linebackers facing
  // the kicking side, with the returner replacing the deep safety.
  'punt-return': [11, [
    [17, defensiveFront],
    [35, { Mike: 5, Sam: 6 }],
    [52, { WS: 3, SS: 9 }],
    [68, { LCB: 2, RCB: 10 }],
    [85, { Returner: 6 }],
  ]],
  'field-goal': [11, [
    [22, { LW: 2, LE: 3, LT: 4, LG: 5, C: 6, RG: 7, RT: 8, RE: 9, RW: 10 }],
    [54, { Holder: 7 }],
    [80, { Kicker: 6 }],
  ]],
};

const anchors = new Map(Object.entries(layouts).map(([id, [columns, bands]]) => {
  const points = new Map();
  for (const [y, roles] of bands) {
    for (const [role, column] of Object.entries(roles)) {
      points.set(role, { x: 6 + 88 * (column - 1) / (columns - 1), y });
    }
  }
  return [id, points];
}));

export function formationLayout(group) {
  const points = anchors.get(group.templateId);
  const markers = [], unmapped = [], occupied = new Set();
  for (const slot of group.slots) {
    const role = slot.templateRole, point = points?.get(role);
    if (point && !occupied.has(role)) {
      markers.push({ slot, ...point });
      occupied.add(role);
    } else {
      unmapped.push(slot);
    }
  }
  return { templateId: points ? group.templateId : null, markers, unmapped };
}

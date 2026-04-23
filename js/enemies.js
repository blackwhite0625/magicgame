/* ================================================================
   enemies.js — 敵人系統
   類型:
   - melee: 近戰衝刺 (骷髏)
   - ranged: 遠程射擊 (暗影術士)
   - caster: 蓄力施法 (石像鬼，會施放攻擊，玩家需擋下)
   - boss: 魔王 (多階段)
   ================================================================ */

(function (global) {
    'use strict';

    const ENEMY_TYPES = {
        skeleton: {
            name: '骷髏戰士',
            color: '#ccccdd',
            hp: 40, radius: 28, baseSpeed: 80,
            damage: 13, attackRange: 50, attackCooldown: 1.1,   // +30% damage
            reward: 50,
            chargeChance: 0.18,    // 衝鋒機率
            chargeSpeedMul: 2.4
        },
        assassin: {
            name: '影刺客',
            color: '#552288',
            hp: 28, radius: 24, baseSpeed: 155,
            damage: 18, attackRange: 55, attackCooldown: 0.9,   // +29% damage
            reward: 90,
            chargeChance: 0.35,
            chargeSpeedMul: 2.8
        },
        warlock: {
            name: '暗影術士',
            color: '#aa66cc',
            hp: 35, radius: 30, baseSpeed: 40,
            damage: 10, attackRange: 500, attackCooldown: 2.2,  // +25% damage
            projectileSpeed: 340, reward: 80,
            barrageChance: 0.3     // 三連射機率
        },
        gargoyle: {
            name: '石像鬼',
            color: '#886644',
            hp: 70, radius: 36, baseSpeed: 55,
            damage: 32, attackRange: 450, attackCooldown: 3.2,  // +28% damage
            castTime: 1.8, reward: 120
        },
        demon: {
            name: '惡魔領主',
            color: '#cc3344',
            hp: 500, radius: 58, baseSpeed: 50,
            damage: 26, attackRange: 500, attackCooldown: 1.9,
            castTime: 1.5, projectileSpeed: 400,
            reward: 500, boss: true,
            barrageChance: 0.5,
            arcShotChance: 0.2   // 新: 機率釋放 120° 扇形投射
        },
        archer: {
            name: '黑影弓手',
            color: '#446688',
            hp: 45, radius: 26, baseSpeed: 48,
            damage: 16, attackRange: 700, attackCooldown: 2.8,
            projectileSpeed: 520, reward: 100,
            volleyChance: 0.4,       // 雙連射機率
            keepDistance: 350         // 會保持距離 kiting
        },
        bomber: {
            name: '爆破兵',
            color: '#cc6644',
            hp: 22, radius: 30, baseSpeed: 95,
            damage: 40, attackRange: 50, attackCooldown: 0.3,
            reward: 75,
            explodeOnContact: true,  // 接觸即爆
            explodeRadius: 110,
            fuseColor: '#ff4422'
        }
    };

    // ==== 各類型敵人的繪製函式 ====
    const TWO_PI = 6.283185307179586;

    function drawSkeleton(ctx, x, y, r) {
        // 軀幹 / 胸骨
        ctx.fillStyle = '#c8c8d0';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.25, r * 0.55, r * 0.5, 0, 0, TWO_PI);
        ctx.fill();
        // 肋骨條紋
        ctx.strokeStyle = '#4a4a55';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
            const ly = y + r * 0.05 + i * r * 0.18;
            ctx.beginPath();
            ctx.moveTo(x - r * 0.4, ly);
            ctx.quadraticCurveTo(x, ly - r * 0.05, x + r * 0.4, ly);
            ctx.stroke();
        }
        // 脊柱
        ctx.strokeStyle = '#3a3a42';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.1);
        ctx.lineTo(x, y + r * 0.65);
        ctx.stroke();
        // 頭骨
        ctx.fillStyle = '#e8e8ec';
        ctx.beginPath();
        ctx.arc(x, y - r * 0.35, r * 0.55, 0, TWO_PI);
        ctx.fill();
        // 下顎
        ctx.fillStyle = '#d4d4d8';
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.1, r * 0.42, r * 0.2, 0, 0, Math.PI);
        ctx.fill();
        // 眼窩
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.35, r * 0.14, 0, TWO_PI);
        ctx.arc(x + r * 0.2, y - r * 0.35, r * 0.14, 0, TWO_PI);
        ctx.fill();
        // 發光瞳孔
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.35, r * 0.06, 0, TWO_PI);
        ctx.arc(x + r * 0.2, y - r * 0.35, r * 0.06, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 鼻洞
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.22);
        ctx.lineTo(x - r * 0.07, y - r * 0.1);
        ctx.lineTo(x + r * 0.07, y - r * 0.1);
        ctx.closePath();
        ctx.fill();
        // 牙齒
        ctx.strokeStyle = '#3a3a42';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            const tx = x - r * 0.18 + i * r * 0.09;
            ctx.beginPath();
            ctx.moveTo(tx, y - r * 0.1);
            ctx.lineTo(tx, y + r * 0.03);
            ctx.stroke();
        }
    }

    function drawWarlock(ctx, x, y, r) {
        // 長袍 (寬底三角)
        const g = ctx.createLinearGradient(x, y - r * 0.4, x, y + r * 1.4);
        g.addColorStop(0, '#6a32a0');
        g.addColorStop(1, '#1a0830');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.45, y - r * 0.35);
        ctx.lineTo(x + r * 0.45, y - r * 0.35);
        ctx.quadraticCurveTo(x + r * 1.1, y + r * 0.6, x + r * 1.2, y + r * 1.1);
        ctx.lineTo(x - r * 1.2, y + r * 1.1);
        ctx.quadraticCurveTo(x - r * 1.1, y + r * 0.6, x - r * 0.45, y - r * 0.35);
        ctx.closePath();
        ctx.fill();
        // 長袍魔法紋 (簡單豎條)
        ctx.strokeStyle = 'rgba(220, 150, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.2, y);
        ctx.lineTo(x - r * 0.4, y + r);
        ctx.moveTo(x + r * 0.2, y);
        ctx.lineTo(x + r * 0.4, y + r);
        ctx.stroke();
        // 兜帽
        ctx.fillStyle = '#3e1a6a';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.05, y - r * 1.1);
        ctx.quadraticCurveTo(x + r * 0.3, y - r, x + r * 0.7, y - r * 0.2);
        ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.05, x, y - r * 0.03);
        ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.05, x - r * 0.7, y - r * 0.2);
        ctx.quadraticCurveTo(x - r * 0.3, y - r, x - r * 0.05, y - r * 1.1);
        ctx.closePath();
        ctx.fill();
        // 兜帽內暗色
        ctx.fillStyle = '#0a0214';
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.45, r * 0.42, r * 0.45, 0, 0, TWO_PI);
        ctx.fill();
        // 發光雙眼
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ff66ff';
        ctx.beginPath();
        ctx.arc(x - r * 0.17, y - r * 0.47, r * 0.16, 0, TWO_PI);
        ctx.arc(x + r * 0.17, y - r * 0.47, r * 0.16, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff99ff';
        ctx.beginPath();
        ctx.arc(x - r * 0.17, y - r * 0.47, r * 0.06, 0, TWO_PI);
        ctx.arc(x + r * 0.17, y - r * 0.47, r * 0.06, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 懸浮魔法球
        const orbX = x - r * 0.75, orbY = y + r * 0.3;
        ctx.globalCompositeOperation = 'lighter';
        const og = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, r * 0.35);
        og.addColorStop(0, 'rgba(255,255,255,0.9)');
        og.addColorStop(0.4, 'rgba(200,100,255,0.6)');
        og.addColorStop(1, 'rgba(100,40,180,0)');
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(orbX, orbY, r * 0.35, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#cc66ff';
        ctx.beginPath();
        ctx.arc(orbX, orbY, r * 0.13, 0, TWO_PI);
        ctx.fill();
    }

    function drawGargoyle(ctx, x, y, r) {
        // 翅膀 (背後展開)
        ctx.fillStyle = '#3a2818';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.3, y - r * 0.2);
        ctx.quadraticCurveTo(x - r * 1.2, y - r * 0.3, x - r * 1.3, y + r * 0.5);
        ctx.quadraticCurveTo(x - r * 0.9, y + r * 0.2, x - r * 0.3, y + r * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + r * 0.3, y - r * 0.2);
        ctx.quadraticCurveTo(x + r * 1.2, y - r * 0.3, x + r * 1.3, y + r * 0.5);
        ctx.quadraticCurveTo(x + r * 0.9, y + r * 0.2, x + r * 0.3, y + r * 0.3);
        ctx.closePath();
        ctx.fill();
        // 翅膀骨架
        ctx.strokeStyle = '#24160a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.3, y - r * 0.1);
        ctx.lineTo(x - r * 1.2, y - r * 0.15);
        ctx.moveTo(x + r * 0.3, y - r * 0.1);
        ctx.lineTo(x + r * 1.2, y - r * 0.15);
        ctx.stroke();

        // 軀幹 (石塊狀)
        ctx.fillStyle = '#7a6244';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y);
        ctx.quadraticCurveTo(x - r * 0.75, y + r * 0.6, x - r * 0.4, y + r * 1);
        ctx.lineTo(x + r * 0.4, y + r * 1);
        ctx.quadraticCurveTo(x + r * 0.75, y + r * 0.6, x + r * 0.5, y);
        ctx.closePath();
        ctx.fill();
        // 裂紋
        ctx.strokeStyle = '#4a3820';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.3, y + r * 0.1);
        ctx.lineTo(x - r * 0.15, y + r * 0.5);
        ctx.lineTo(x - r * 0.25, y + r * 0.8);
        ctx.stroke();

        // 頭部
        ctx.fillStyle = '#8a7250';
        ctx.beginPath();
        ctx.arc(x, y - r * 0.3, r * 0.55, 0, TWO_PI);
        ctx.fill();
        // 頭部陰影
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(x + r * 0.1, y - r * 0.25, r * 0.5, 0, TWO_PI);
        ctx.fill();

        // 大犄角
        ctx.fillStyle = '#2a1c10';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.45, y - r * 0.65);
        ctx.quadraticCurveTo(x - r * 0.7, y - r * 1.1, x - r * 0.3, y - r * 1.2);
        ctx.lineTo(x - r * 0.25, y - r * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + r * 0.45, y - r * 0.65);
        ctx.quadraticCurveTo(x + r * 0.7, y - r * 1.1, x + r * 0.3, y - r * 1.2);
        ctx.lineTo(x + r * 0.25, y - r * 0.65);
        ctx.closePath();
        ctx.fill();

        // 發光紅眼
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#ff3322';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.3, r * 0.15, 0, TWO_PI);
        ctx.arc(x + r * 0.2, y - r * 0.3, r * 0.15, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffcc44';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.3, r * 0.06, 0, TWO_PI);
        ctx.arc(x + r * 0.2, y - r * 0.3, r * 0.06, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // 獠牙
        ctx.fillStyle = '#e8dcc0';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.14, y - r * 0.02);
        ctx.lineTo(x - r * 0.08, y + r * 0.1);
        ctx.lineTo(x - r * 0.05, y - r * 0.02);
        ctx.closePath();
        ctx.moveTo(x + r * 0.14, y - r * 0.02);
        ctx.lineTo(x + r * 0.08, y + r * 0.1);
        ctx.lineTo(x + r * 0.05, y - r * 0.02);
        ctx.closePath();
        ctx.fill();
    }

    function drawDemon(ctx, x, y, r) {
        // 巨大翅膀展開
        ctx.fillStyle = '#420a12';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.35, y - r * 0.3);
        ctx.quadraticCurveTo(x - r * 1.5, y - r * 0.6, x - r * 1.6, y + r * 0.3);
        ctx.quadraticCurveTo(x - r * 1.3, y + r * 0.15, x - r * 1.0, y + r * 0.2);
        ctx.quadraticCurveTo(x - r * 1.2, y + r * 0.6, x - r * 0.8, y + r * 0.5);
        ctx.quadraticCurveTo(x - r * 0.6, y + r * 0.4, x - r * 0.3, y + r * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + r * 0.35, y - r * 0.3);
        ctx.quadraticCurveTo(x + r * 1.5, y - r * 0.6, x + r * 1.6, y + r * 0.3);
        ctx.quadraticCurveTo(x + r * 1.3, y + r * 0.15, x + r * 1.0, y + r * 0.2);
        ctx.quadraticCurveTo(x + r * 1.2, y + r * 0.6, x + r * 0.8, y + r * 0.5);
        ctx.quadraticCurveTo(x + r * 0.6, y + r * 0.4, x + r * 0.3, y + r * 0.2);
        ctx.closePath();
        ctx.fill();

        // 軀幹 (深紅)
        const bg = ctx.createLinearGradient(x, y - r * 0.3, x, y + r * 1.1);
        bg.addColorStop(0, '#a02030');
        bg.addColorStop(1, '#401018');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.55, y - r * 0.2);
        ctx.quadraticCurveTo(x - r * 0.85, y + r * 0.6, x - r * 0.55, y + r * 1.05);
        ctx.lineTo(x + r * 0.55, y + r * 1.05);
        ctx.quadraticCurveTo(x + r * 0.85, y + r * 0.6, x + r * 0.55, y - r * 0.2);
        ctx.closePath();
        ctx.fill();

        // 骨架紋
        ctx.strokeStyle = '#200810';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.1);
        ctx.lineTo(x, y + r * 0.9);
        for (let i = 0; i < 3; i++) {
            const ly = y + r * 0.1 + i * r * 0.25;
            ctx.moveTo(x - r * 0.25, ly);
            ctx.quadraticCurveTo(x, ly + r * 0.05, x + r * 0.25, ly);
        }
        ctx.stroke();

        // 頭部
        const hg = ctx.createRadialGradient(x, y - r * 0.45, 0, x, y - r * 0.45, r * 0.7);
        hg.addColorStop(0, '#b82838');
        hg.addColorStop(1, '#400610');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(x, y - r * 0.45, r * 0.6, 0, TWO_PI);
        ctx.fill();

        // 巨型犄角
        ctx.fillStyle = '#201010';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y - r * 0.8);
        ctx.quadraticCurveTo(x - r * 0.85, y - r * 1.35, x - r * 0.45, y - r * 1.45);
        ctx.quadraticCurveTo(x - r * 0.3, y - r * 1.0, x - r * 0.3, y - r * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + r * 0.5, y - r * 0.8);
        ctx.quadraticCurveTo(x + r * 0.85, y - r * 1.35, x + r * 0.45, y - r * 1.45);
        ctx.quadraticCurveTo(x + r * 0.3, y - r * 1.0, x + r * 0.3, y - r * 0.75);
        ctx.closePath();
        ctx.fill();
        // 犄角條紋
        ctx.strokeStyle = '#080202';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x - r * 0.5 + i * r * 0.1, y - r * 0.95 - i * r * 0.1);
            ctx.lineTo(x - r * 0.42 + i * r * 0.08, y - r * 0.9 - i * r * 0.1);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + r * 0.5 - i * r * 0.1, y - r * 0.95 - i * r * 0.1);
            ctx.lineTo(x + r * 0.42 - i * r * 0.08, y - r * 0.9 - i * r * 0.1);
            ctx.stroke();
        }

        // 發光黃眼
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#ffcc22';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.45, r * 0.2, 0, TWO_PI);
        ctx.arc(x + r * 0.2, y - r * 0.45, r * 0.2, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffff88';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.45, r * 0.08, 0, TWO_PI);
        ctx.arc(x + r * 0.2, y - r * 0.45, r * 0.08, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // 獠牙下垂
        ctx.fillStyle = '#f0e4c0';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.16, y - r * 0.22);
        ctx.lineTo(x - r * 0.08, y - r * 0.05);
        ctx.lineTo(x - r * 0.04, y - r * 0.22);
        ctx.closePath();
        ctx.moveTo(x + r * 0.16, y - r * 0.22);
        ctx.lineTo(x + r * 0.08, y - r * 0.05);
        ctx.lineTo(x + r * 0.04, y - r * 0.22);
        ctx.closePath();
        ctx.fill();
    }

    function drawAssassin(ctx, x, y, r) {
        // 黑色斗篷 (窄長)
        ctx.fillStyle = '#1a0828';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.35, y - r * 0.3);
        ctx.lineTo(x + r * 0.35, y - r * 0.3);
        ctx.quadraticCurveTo(x + r * 0.75, y + r * 0.5, x + r * 0.95, y + r * 1.2);
        ctx.lineTo(x - r * 0.95, y + r * 1.2);
        ctx.quadraticCurveTo(x - r * 0.75, y + r * 0.5, x - r * 0.35, y - r * 0.3);
        ctx.closePath();
        ctx.fill();
        // 裂口紋 (移動時的飄動)
        ctx.strokeStyle = '#3a1a5a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.1, y - r * 0.2);
        ctx.lineTo(x - r * 0.2, y + r * 1.1);
        ctx.moveTo(x + r * 0.1, y - r * 0.2);
        ctx.lineTo(x + r * 0.2, y + r * 1.1);
        ctx.stroke();
        // 兜帽 (尖頂)
        ctx.fillStyle = '#0a0218';
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.2);
        ctx.quadraticCurveTo(x + r * 0.55, y - r * 0.9, x + r * 0.6, y - r * 0.15);
        ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.02, x, y);
        ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.02, x - r * 0.6, y - r * 0.15);
        ctx.quadraticCurveTo(x - r * 0.55, y - r * 0.9, x, y - r * 1.2);
        ctx.closePath();
        ctx.fill();
        // 兜帽內暗
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.38, r * 0.36, r * 0.42, 0, 0, TWO_PI);
        ctx.fill();
        // 黃色瞳孔 (銳利狹長)
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffcc33';
        ctx.beginPath();
        ctx.ellipse(x - r * 0.15, y - r * 0.4, r * 0.04, r * 0.1, 0, 0, TWO_PI);
        ctx.ellipse(x + r * 0.15, y - r * 0.4, r * 0.04, r * 0.1, 0, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 匕首 (側邊)
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + r * 0.5, y + r * 0.2);
        ctx.lineTo(x + r * 0.85, y - r * 0.4);
        ctx.stroke();
        ctx.fillStyle = '#3a1a2a';
        ctx.fillRect(x + r * 0.46, y + r * 0.18, 4, 8);
    }

    function drawArcher(ctx, x, y, r) {
        // 暗色長袍
        ctx.fillStyle = '#2a3a48';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.42, y - r * 0.3);
        ctx.lineTo(x + r * 0.42, y - r * 0.3);
        ctx.quadraticCurveTo(x + r * 0.95, y + r * 0.6, x + r * 1.05, y + r * 1.2);
        ctx.lineTo(x - r * 1.05, y + r * 1.2);
        ctx.quadraticCurveTo(x - r * 0.95, y + r * 0.6, x - r * 0.42, y - r * 0.3);
        ctx.closePath();
        ctx.fill();
        // 兜帽
        ctx.fillStyle = '#1a2838';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.05, y - r * 1.15);
        ctx.quadraticCurveTo(x + r * 0.55, y - r * 0.9, x + r * 0.65, y - r * 0.2);
        ctx.quadraticCurveTo(x + r * 0.2, y - r * 0.02, x, y);
        ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.02, x - r * 0.65, y - r * 0.2);
        ctx.quadraticCurveTo(x - r * 0.55, y - r * 0.9, x - r * 0.05, y - r * 1.15);
        ctx.closePath();
        ctx.fill();
        // 內黑
        ctx.fillStyle = '#060a12';
        ctx.beginPath();
        ctx.ellipse(x, y - r * 0.45, r * 0.4, r * 0.45, 0, 0, TWO_PI);
        ctx.fill();
        // 發光眼
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#66ccff';
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(x - r * 0.18, y - r * 0.5, r * 0.14, 0, TWO_PI);
        ctx.arc(x + r * 0.18, y - r * 0.5, r * 0.14, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#aaddff';
        ctx.beginPath();
        ctx.arc(x - r * 0.18, y - r * 0.5, r * 0.06, 0, TWO_PI);
        ctx.arc(x + r * 0.18, y - r * 0.5, r * 0.06, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 弓 (右側)
        ctx.strokeStyle = '#5a3a20';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x + r * 0.55, y + r * 0.1, r * 0.65, -Math.PI * 0.8, Math.PI * 0.8);
        ctx.stroke();
        // 弦
        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + r * 0.55 + Math.cos(-Math.PI * 0.8) * r * 0.65, y + r * 0.1 + Math.sin(-Math.PI * 0.8) * r * 0.65);
        ctx.lineTo(x + r * 0.55 + Math.cos(Math.PI * 0.8) * r * 0.65, y + r * 0.1 + Math.sin(Math.PI * 0.8) * r * 0.65);
        ctx.stroke();
    }

    function drawBomber(ctx, x, y, r) {
        // 壯碩身體 (紅黑炸彈體型)
        const g = ctx.createRadialGradient(x, y + r * 0.2, 0, x, y + r * 0.2, r);
        g.addColorStop(0, '#994422');
        g.addColorStop(1, '#4a1a0a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y + r * 0.15, r * 0.85, 0, TWO_PI);
        ctx.fill();
        // 腰帶 (炸彈線)
        ctx.strokeStyle = '#ff9944';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y + r * 0.2, r * 0.75, 0, TWO_PI);
        ctx.stroke();
        // 頭部
        ctx.fillStyle = '#3a1408';
        ctx.beginPath();
        ctx.arc(x, y - r * 0.35, r * 0.5, 0, TWO_PI);
        ctx.fill();
        // 紅色發光眼 (威脅感)
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ff2200';
        ctx.globalAlpha = 0.5;
        const pulse = 0.7 + Math.sin(Date.now() / 120) * 0.3;
        ctx.beginPath();
        ctx.arc(x - r * 0.15, y - r * 0.35, r * 0.12 * pulse, 0, TWO_PI);
        ctx.arc(x + r * 0.15, y - r * 0.35, r * 0.12 * pulse, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffcc22';
        ctx.beginPath();
        ctx.arc(x - r * 0.15, y - r * 0.35, r * 0.05, 0, TWO_PI);
        ctx.arc(x + r * 0.15, y - r * 0.35, r * 0.05, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 引信 (頂部火花)
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.75);
        ctx.quadraticCurveTo(x + r * 0.1, y - r * 1.0, x + r * 0.05, y - r * 1.2);
        ctx.stroke();
        // 火花
        const tFlicker = Date.now() / 80;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ff6622';
        ctx.beginPath();
        ctx.arc(x + r * 0.05 + Math.sin(tFlicker) * 2, y - r * 1.2 + Math.cos(tFlicker) * 2, 4, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = '#ffee66';
        ctx.beginPath();
        ctx.arc(x + r * 0.05, y - r * 1.2, 2, 0, TWO_PI);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    const DRAW_FNS = {
        skeleton: drawSkeleton,
        assassin: drawAssassin,
        warlock: drawWarlock,
        gargoyle: drawGargoyle,
        demon: drawDemon,
        archer: drawArcher,
        bomber: drawBomber
    };

    // 敵人投射物
    const enemyProjectiles = [];

    /**
     * 建立敵人
     * @param {string} type
     * @param {number} x @param {number} y
     * @param {{hpMul?:number, speedMul?:number}=} scale 無限模式用的難度倍率
     */
    function createEnemy(type, x, y, scale) {
        const def = ENEMY_TYPES[type];
        if (!def) return null;
        const hpMul = (scale && scale.hpMul) || 1;
        const speedMul = (scale && scale.speedMul) || 1;
        const damageMul = (scale && scale.damageMul) || 1;
        const hp = Math.round(def.hp * hpMul);
        // 對原始 def 套上倍率後建立副本 (不污染原 def)
        const scaledDef = Object.assign({}, def, {
            damage: def.damage * damageMul
        });
        return {
            type: type,
            def: scaledDef,
            x: x, y: y,
            hp: hp, maxHp: hp,
            radius: def.radius,
            speed: def.baseSpeed * speedMul,
            baseSpeed: def.baseSpeed * speedMul,
            attackTimer: def.attackCooldown * Math.random(),
            castTimer: 0,
            casting: false,
            dead: false,
            slowedUntil: 0,
            hitFlash: 0,
            chargeUntil: 0,
            bobPhase: Math.random() * Math.PI * 2
        };
    }

    /**
     * 更新敵人 AI
     */
    function updateEnemies(dt, enemies, playerRef, onPlayerHit, onCastStart) {
        const now = performance.now();
        for (const e of enemies) {
            if (e.dead) continue;

            e.bobPhase += dt * 3;
            e.hitFlash = Math.max(0, e.hitFlash - dt);

            // 處理減速
            if (now < e.slowedUntil) {
                e.speed = e.baseSpeed * (e.slowFactor || 0.4);
            } else {
                e.speed = e.baseSpeed;
            }

            // 衝鋒計時器: 時間內速度大幅提升
            if (e.chargeUntil && now < e.chargeUntil) {
                e.speed = e.speed * (e.def.chargeSpeedMul || 2.0);
            } else if (e.chargeUntil) {
                e.chargeUntil = 0;
            }

            const dx = playerRef.x - e.x;
            const dy = playerRef.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // 機率觸發衝鋒 (距離中等時, 對近戰型)
            if (e.def.chargeChance && !e.chargeUntil && dist < 280 && dist > e.def.attackRange + 20) {
                if (Math.random() < e.def.chargeChance * dt * 3) {
                    e.chargeUntil = now + 800;  // 0.8 秒衝鋒
                }
            }

            // Archer kite 行為: 距離太近反而後退
            if (e.def.keepDistance && dist < e.def.keepDistance * 0.7) {
                e.x -= (dx / dist) * e.speed * 0.6 * dt;
                e.y -= (dy / dist) * e.speed * 0.6 * dt;
            } else if (e.def.keepDistance && dist < e.def.keepDistance && dist > e.def.keepDistance * 0.7) {
                // 停在射程外緣, 不衝上來
            }
            // 移動邏輯: 接近玩家直到攻擊範圍
            else if (dist > e.def.attackRange) {
                e.x += (dx / dist) * e.speed * dt;
                e.y += (dy / dist) * e.speed * dt;
            } else {
                // 在攻擊範圍內
                e.attackTimer -= dt;
                if (e.casting) {
                    e.castTimer -= dt;
                    if (e.castTimer <= 0) {
                        // 蓄力完成，釋放攻擊
                        performAttack(e, playerRef, onPlayerHit);
                        e.casting = false;
                        e.attackTimer = e.def.attackCooldown;
                    }
                } else if (e.attackTimer <= 0) {
                    // 觸發攻擊
                    if (e.def.castTime) {
                        // 需要蓄力 (玩家要擋)
                        e.casting = true;
                        e.castTimer = e.def.castTime;
                        if (onCastStart) onCastStart(e);
                    } else {
                        performAttack(e, playerRef, onPlayerHit);
                        e.attackTimer = e.def.attackCooldown;
                    }
                }
            }
        }

        // 更新敵方投射物
        for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
            const p = enemyProjectiles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            global.Particles.emitTrail(p.x, p.y, '#cc66ff');
            const ddx = p.x - playerRef.x;
            const ddy = p.y - playerRef.y;
            const r = p.radius + playerRef.radius;
            if (ddx * ddx + ddy * ddy < r * r) {
                onPlayerHit(p.damage, p);
                enemyProjectiles.splice(i, 1);
                continue;
            }
            if (p.life <= 0 || p.x < -80 || p.x > 4000) {
                enemyProjectiles.splice(i, 1);
            }
        }
    }

    function performAttack(e, playerRef, onPlayerHit) {
        // Bomber: 近身自爆 (AOE), 隨後死亡
        if (e.type === 'bomber' && e.def.explodeOnContact) {
            const dx = playerRef.x - e.x, dy = playerRef.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < e.def.explodeRadius) {
                onPlayerHit(e.def.damage, { kind: 'explode', x: e.x, y: e.y });
            }
            // 爆炸特效
            global.Particles.burst(e.x, e.y, {
                count: 60, spread: 450, life: 1.0,
                color: '#ff6622', color2: '#ffcc44', size: 6
            });
            // 殺死自己
            e.hp = 0;
            e.dead = true;
            return;
        }
        // 近戰型 (skeleton/assassin): 直接扣血 — 進入距離才觸發
        if (e.type === 'skeleton' || e.type === 'assassin') {
            onPlayerHit(e.def.damage, { kind: 'melee', x: e.x, y: e.y });
            return;
        }
        // 遠程型
        const dx = playerRef.x - e.x;
        const dy = playerRef.y - e.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const speed = e.def.projectileSpeed || 300;
        const baseAngle = Math.atan2(dy, dx);
        // 可能觸發三連射
        const doBarrage = e.def.barrageChance && Math.random() < e.def.barrageChance;
        const angleOffsets = doBarrage ? [-0.25, 0, 0.25] : [0];
        for (const off of angleOffsets) {
            const a = baseAngle + off;
            enemyProjectiles.push({
                x: e.x, y: e.y,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed,
                damage: e.def.damage * (doBarrage ? 0.7 : 1),   // 三連射每發減傷
                radius: 14,
                life: 3,
                source: e.type,
                heavy: !!e.def.castTime,
                barrage: doBarrage
            });
        }
    }

    /**
     * 渲染敵人 — 批次分趟渲染 (陰影 / 外圈光暈 / 造型 / 資訊條)
     */
    function renderEnemies(ctx, enemies) {
        if (enemies.length === 0) return;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 第一趟: 陰影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (e.dead) continue;
            ctx.beginPath();
            ctx.ellipse(e.x, e.y + e.radius + 6, e.radius * 0.75, 7, 0, 0, TWO_PI);
            ctx.fill();
        }

        // 第二趟: 外圈光暈
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (e.dead) continue;
            const bob = Math.sin(e.bobPhase) * 4;
            ctx.fillStyle = e.def.color;
            ctx.beginPath();
            ctx.arc(e.x, e.y + bob, e.radius * 1.5, 0, TWO_PI);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // 第三趟: 各型造型繪製
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (e.dead) continue;
            const bob = Math.sin(e.bobPhase) * 4;
            // 閒置呼吸縮放 — 每隻怪物相位不同, 避免整齊劃一的 AI 感
            const breathe = 1 + Math.sin(e.bobPhase * 0.8) * 0.03;
            // 蓄力時抖動 — 施法前有 "抖動警示"
            const castShake = e.casting ? {
                x: (Math.random() - 0.5) * 3,
                y: (Math.random() - 0.5) * 3
            } : { x: 0, y: 0 };
            const drawFn = DRAW_FNS[e.type];
            if (drawFn) {
                ctx.save();
                ctx.translate(e.x + castShake.x, e.y + bob + castShake.y);
                ctx.scale(breathe, breathe);
                drawFn(ctx, 0, 0, e.radius);
                ctx.restore();
            }

            // 受傷閃白
            if (e.hitFlash > 0) {
                ctx.globalCompositeOperation = 'lighter';
                ctx.fillStyle = 'rgba(255, 255, 255, ' + e.hitFlash * 0.7 + ')';
                ctx.beginPath();
                ctx.arc(e.x, e.y + bob, e.radius * 1.1, 0, TWO_PI);
                ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
            }

            // 蓄力指示條 (紅色) + 大字警示
            if (e.casting) {
                const pct = 1 - e.castTimer / e.def.castTime;
                const barW = e.radius * 2.2;
                const barX = e.x - barW / 2;
                const barY = e.y - e.radius - 18;
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(barX, barY, barW, 6);
                ctx.fillStyle = '#ff3344';
                ctx.fillRect(barX, barY, barW * pct, 6);
                // 閃爍邊框
                ctx.strokeStyle = `rgba(255, 80, 80, ${0.5 + Math.sin(Date.now() / 80) * 0.4})`;
                ctx.lineWidth = 2;
                ctx.strokeRect(barX, barY, barW, 6);
                // 警示符號
                ctx.fillStyle = '#ff3344';
                ctx.font = 'bold 20px Georgia';
                ctx.fillText('⚠', e.x, e.y - e.radius - 36);
            }

            // HP 條
            const hpPct = e.hp / e.maxHp;
            if (hpPct < 1) {
                const barW = e.radius * 2.2;
                const barX = e.x - barW / 2;
                const barY = e.y - e.radius - 10;
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillRect(barX, barY, barW, 5);
                ctx.fillStyle = hpPct > 0.5 ? '#66ff66' : hpPct > 0.25 ? '#ffcc44' : '#ff4466';
                ctx.fillRect(barX, barY, barW * hpPct, 5);
                ctx.strokeStyle = 'rgba(255,255,255,0.4)';
                ctx.lineWidth = 1;
                ctx.strokeRect(barX, barY, barW, 5);
            }

            // 減速標記
            if (performance.now() < e.slowedUntil) {
                ctx.fillStyle = '#88ddff';
                ctx.font = '14px serif';
                ctx.fillText('❄', e.x + e.radius, e.y - e.radius);
            }
        }
        ctx.restore();
    }

    /**
     * 渲染敵方投射物 — 批次 + 無 shadowBlur
     */
    function renderEnemyProjectiles(ctx) {
        if (enemyProjectiles.length === 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // 光暈
        ctx.globalAlpha = 0.35;
        for (let i = 0; i < enemyProjectiles.length; i++) {
            const p = enemyProjectiles[i];
            ctx.fillStyle = p.heavy ? '#ff4466' : '#cc66ff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * 2, 0, 6.283185307179586);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        // 本體
        for (let i = 0; i < enemyProjectiles.length; i++) {
            const p = enemyProjectiles[i];
            ctx.fillStyle = p.heavy ? '#ff4466' : '#bb66ff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, 6.283185307179586);
            ctx.fill();
        }
        // 核心
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < enemyProjectiles.length; i++) {
            const p = enemyProjectiles[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * 0.4, 0, 6.283185307179586);
            ctx.fill();
        }
        ctx.restore();
    }

    function getEnemyProjectiles() { return enemyProjectiles; }

    function clearProjectiles() { enemyProjectiles.length = 0; }

    /** 對敵人造成傷害，並處理死亡 */
    function damageEnemy(enemy, damage, effect) {
        enemy.hp -= damage;
        enemy.hitFlash = 1;
        global.Particles.emitHitSplash(enemy.x, enemy.y, effect && effect.kind === 'icespike' ? '#88ccff' : '#ff4466');
        if (effect && effect.kind === 'icespike' && effect.slowDuration) {
            enemy.slowedUntil = performance.now() + effect.slowDuration * 1000;
            enemy.slowFactor = effect.slowFactor;
        }
        if (enemy.hp <= 0) {
            enemy.dead = true;
            // 死亡爆發
            global.Particles.burst(enemy.x, enemy.y, {
                count: 40,
                spread: 250,
                life: 1,
                color: '#ff88aa',
                color2: '#442244',
                size: 5
            });
        }
    }

    /**
     * 根據關卡編號產生敵人波次
     * @param {number} levelNum
     * @param {{w:number,h:number}} canvasSize - 實際畫布尺寸
     * @returns {Array} waves: [{delay:number, spawns:[{type, x, y}]}]
     */
    function buildLevel(levelNum, canvasSize) {
        const W = (canvasSize && canvasSize.w) || 1280;
        const H = (canvasSize && canvasSize.h) || 720;
        const spawnX = W - 80;
        const waves = [];

        const mid = H / 2;
        const w = (delay, spawns) => waves.push({ delay: delay, spawns: spawns });
        const e = (type, dy) => ({ type: type, x: spawnX, y: mid + (dy || 0) });

        switch (levelNum) {
            case 1: // 墓園入口 — 教學
                w(1, [e('skeleton')]);
                w(5, [e('skeleton', -100)]);
                w(9, [e('skeleton', 100)]);
                break;
            case 2: // 迷霧森林 — 遠程登場
                w(1, [e('skeleton'), e('warlock', -120)]);
                w(7, [e('warlock', 120), e('skeleton', -100)]);
                w(14, [e('skeleton', -150), e('skeleton', 150), e('warlock')]);
                break;
            case 3: // 遺忘神殿 — 石像鬼首戰
                w(1, [e('gargoyle')]);
                w(8, [e('skeleton', -150), e('warlock', 150)]);
                w(16, [e('gargoyle', -80), e('skeleton', 80)]);
                break;
            case 4: // 暗影小徑 — 刺客登場
                w(1, [e('skeleton', -100), e('skeleton', 100)]);
                w(6, [e('assassin', -80), e('assassin', 80)]);
                w(13, [e('warlock', -150), e('warlock', 150), e('skeleton')]);
                w(22, [e('gargoyle'), e('assassin', -120)]);
                break;
            case 5: // 血月峽谷 — Boss 1
                w(1, [e('demon')]);
                w(10, [e('skeleton', -180), e('skeleton', 180)]);
                w(18, [e('warlock', -200), e('warlock', 200)]);
                w(28, [e('gargoyle', -150), e('assassin', 150)]);
                break;
            case 6: // 枯骨祭壇 — 數量壓力
                w(1, [e('skeleton', -150), e('skeleton'), e('skeleton', 150)]);
                w(7, [e('assassin', -100), e('warlock', 100)]);
                w(14, [e('gargoyle'), e('skeleton', -180), e('skeleton', 180)]);
                w(24, [e('warlock', -200), e('warlock'), e('warlock', 200)]);
                break;
            case 7: // 陰影迴廊 — 高速衝擊
                w(1, [e('assassin', -80), e('assassin', 80)]);
                w(4, [e('assassin'), e('assassin', -150), e('assassin', 150)]);
                w(12, [e('gargoyle', -100), e('gargoyle', 100)]);
                w(22, [e('warlock', -180), e('assassin'), e('warlock', 180)]);
                break;
            case 8: // 地底牢獄 — 連鎖石像鬼
                w(1, [e('gargoyle', -100), e('gargoyle', 100)]);
                w(8, [e('skeleton', -180), e('assassin'), e('skeleton', 180)]);
                w(16, [e('gargoyle'), e('warlock', -150), e('warlock', 150)]);
                w(26, [e('gargoyle', -80), e('gargoyle', 80), e('assassin')]);
                break;
            case 9: // 熔岩深淵 — 全兵種混戰
                w(1, [e('skeleton', -200), e('warlock', -100), e('assassin'), e('warlock', 100), e('skeleton', 200)]);
                w(12, [e('gargoyle', -120), e('gargoyle', 120)]);
                w(22, [e('assassin', -80), e('assassin', 80), e('warlock'), e('skeleton', -200), e('skeleton', 200)]);
                break;
            case 10: // 暴風之眼 — Boss 2 (雙惡魔)
                w(1, [e('demon', -120), e('demon', 120)]);
                w(15, [e('skeleton', -200), e('assassin'), e('skeleton', 200)]);
                w(28, [e('warlock', -180), e('gargoyle'), e('warlock', 180)]);
                break;
            case 11: // 虛空邊境 — 精英部隊
                w(1, [e('gargoyle', -150), e('warlock'), e('gargoyle', 150)]);
                w(10, [e('assassin', -100), e('assassin'), e('assassin', 100)]);
                w(20, [e('warlock', -200), e('gargoyle', -80), e('gargoyle', 80), e('warlock', 200)]);
                w(32, [e('demon'), e('assassin', -150), e('assassin', 150)]);
                break;
            case 12: // 惡魔王座 — 中期魔王
                w(1, [e('demon')]);
                w(8, [e('gargoyle', -150), e('gargoyle', 150)]);
                w(18, [e('assassin', -180), e('warlock'), e('assassin', 180)]);
                w(28, [e('demon', -120), e('demon', 120)]);
                w(42, [e('warlock', -200), e('gargoyle', -80), e('assassin'), e('gargoyle', 80), e('warlock', 200)]);
                break;
            case 13: // 暮色殿堂
                w(1, [e('gargoyle', -100), e('warlock'), e('gargoyle', 100)]);
                w(10, [e('assassin', -180), e('assassin'), e('assassin', 180)]);
                w(20, [e('warlock', -200), e('warlock'), e('warlock', 200)]);
                w(30, [e('gargoyle', -120), e('assassin'), e('gargoyle', 120)]);
                break;
            case 14: // 骸骨迴廊
                w(1, [e('skeleton', -200), e('assassin', -80), e('assassin', 80), e('skeleton', 200)]);
                w(8, [e('gargoyle'), e('warlock', -150), e('warlock', 150)]);
                w(18, [e('assassin', -100), e('assassin'), e('assassin', 100), e('gargoyle', -180), e('gargoyle', 180)]);
                w(32, [e('warlock', -200), e('demon'), e('warlock', 200)]);
                break;
            case 15: // 魔焰之塔 — Boss 3
                w(1, [e('demon'), e('gargoyle', -150), e('gargoyle', 150)]);
                w(12, [e('assassin', -180), e('assassin', -60), e('assassin', 60), e('assassin', 180)]);
                w(25, [e('warlock', -180), e('demon'), e('warlock', 180)]);
                w(40, [e('gargoyle', -120), e('demon', -60), e('demon', 60), e('gargoyle', 120)]);
                break;
            case 16: // 失落遺跡
                w(1, [e('warlock', -200), e('warlock', -80), e('warlock', 80), e('warlock', 200)]);
                w(10, [e('gargoyle', -100), e('assassin'), e('gargoyle', 100)]);
                w(22, [e('demon', -150), e('demon', 150)]);
                w(35, [e('assassin', -200), e('warlock'), e('assassin', 200), e('gargoyle')]);
                break;
            case 17: // 裂界之淵
                w(1, [e('assassin', -120), e('assassin'), e('assassin', 120)]);
                w(5, [e('assassin', -200), e('assassin', -80), e('assassin', 80), e('assassin', 200)]);
                w(15, [e('demon', -100), e('demon', 100)]);
                w(28, [e('gargoyle', -160), e('warlock'), e('gargoyle', 160), e('assassin', -40), e('assassin', 40)]);
                break;
            case 18: // 元素熔爐
                w(1, [e('gargoyle', -150), e('gargoyle'), e('gargoyle', 150)]);
                w(12, [e('warlock', -200), e('warlock', -80), e('warlock', 80), e('warlock', 200)]);
                w(22, [e('demon'), e('assassin', -180), e('assassin', 180)]);
                w(35, [e('gargoyle', -100), e('demon', -30), e('demon', 30), e('gargoyle', 100)]);
                break;
            case 19: // 邪神之眼
                w(1, [e('demon', -100), e('demon', 100)]);
                w(12, [e('gargoyle', -200), e('gargoyle'), e('gargoyle', 200)]);
                w(22, [e('warlock', -180), e('assassin', -60), e('assassin', 60), e('warlock', 180)]);
                w(35, [e('demon'), e('gargoyle', -130), e('gargoyle', 130), e('warlock', -220), e('warlock', 220)]);
                break;
            case 20: // 終局之戰 — 手做 Boss
                w(1, [e('demon', -140), e('demon', 0), e('demon', 140)]);
                w(15, [e('gargoyle', -180), e('assassin', -60), e('assassin', 60), e('gargoyle', 180)]);
                w(28, [e('warlock', -220), e('warlock', -80), e('warlock', 80), e('warlock', 220)]);
                w(42, [e('demon', -100), e('gargoyle'), e('demon', 100), e('assassin', -200), e('assassin', 200)]);
                w(60, [e('demon', -150), e('demon', 0), e('demon', 150), e('gargoyle', -220), e('gargoyle', 220)]);
                break;
            default:
                generateHighLevel(levelNum, spawnX, mid, w, e, canvasSize);
                break;
        }

        return waves;
    }

    // 偽隨機 (以 levelNum 為種子)
    function mkRand(seed) {
        let s = seed;
        return () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    // 程序化生成 21-50 關
    function generateHighLevel(levelNum, spawnX, mid, w, e, canvasSize) {
        const rand = mkRand(levelNum * 13 + 7);
        const tier = Math.min(5, Math.floor((levelNum - 21) / 5));    // 0~5
        const isBossLv = levelNum % 5 === 0;
        const W = (canvasSize && canvasSize.w) || 1280;
        const H = (canvasSize && canvasSize.h) || 720;
        // tier 1+ (level 26+): 開放 4 面八方進攻
        const multiSide = tier >= 1;
        const sidePool = ['right', 'left', 'top', 'bottom'];
        const randSide = () => sidePool[Math.floor(rand() * sidePool.length)];
        const randPos = () => {
            if (!multiSide) return null;
            return pickSpawnPos(W, H, randSide());
        };

        // 敵種池 — 高關卡都可出現
        const pool = ['skeleton', 'warlock', 'gargoyle', 'assassin', 'archer', 'bomber'];
        const bossPool = ['demon'];

        const mkSpawn = (type) => {
            const pos = randPos();
            return pos ? { type: type, x: pos.x, y: pos.y } : e(type, (rand() - 0.5) * 300);
        };

        if (isBossLv) {
            const demonCount = Math.min(3, 1 + Math.floor(tier / 2));
            const demons = [];
            for (let i = 0; i < demonCount; i++) {
                if (multiSide) demons.push(mkSpawn('demon'));
                else demons.push(e('demon', (i - (demonCount - 1) / 2) * 150));
            }
            w(1, demons);
            const supportWaves = 2 + tier;
            let delay = 12;
            for (let i = 0; i < supportWaves; i++) {
                const count = 3 + i + Math.floor(tier / 2);
                const spawns = [];
                for (let j = 0; j < count; j++) {
                    const t = pool[Math.floor(rand() * pool.length)];
                    spawns.push(mkSpawn(t));
                }
                w(delay, spawns);
                delay += 14 + i * 2;
            }
            if (tier >= 2) {
                w(delay + 8, [mkSpawn('demon'), mkSpawn('demon'), mkSpawn('gargoyle')]);
            }
        } else {
            const waveCount = 4 + Math.min(2, tier);
            let delay = 1;
            for (let i = 0; i < waveCount; i++) {
                const count = 3 + i + tier;
                const spawns = [];
                for (let j = 0; j < count; j++) {
                    let t;
                    const roll = rand();
                    if (tier >= 2 && i >= waveCount - 1 && roll < 0.25) t = 'gargoyle';
                    else if (tier >= 3 && roll < 0.15) t = 'gargoyle';
                    else if (roll < 0.3) t = 'warlock';
                    else if (roll < 0.55) t = 'assassin';
                    else t = 'skeleton';
                    spawns.push(mkSpawn(t));
                }
                if (tier >= 3 && i === waveCount - 1 && rand() < 0.4) {
                    spawns.push(mkSpawn('demon'));
                }
                w(delay, spawns);
                delay += 7 + Math.floor(rand() * 3);
            }
        }
    }

    // 取得關卡難度倍率 (21+ 逐步增強)
    function getLevelScale(levelNum) {
        if (levelNum <= 20) return { hpMul: 1, speedMul: 1, damageMul: 1 };
        const extra = levelNum - 20;  // 1..30
        return {
            hpMul: 1 + extra * 0.10,
            speedMul: 1 + Math.min(0.7, extra * 0.02),
            damageMul: 1 + Math.min(0.5, extra * 0.015)
        };
    }

    /**
     * 無限模式單波產生器 — 依波次縮放難度
     * @param {number} waveNum 1-based
     * @param {{w:number,h:number}} canvasSize
     * @returns {{spawns:Array, difficulty:number, hpMul:number, speedMul:number}}
     */
    // 隨機從 4 方位挑一個 spawn 位置
    function pickSpawnPos(W, H, preferredSide) {
        const sides = ['right', 'left', 'top', 'bottom'];
        const side = preferredSide || sides[Math.floor(Math.random() * sides.length)];
        const jitterY = (Math.random() - 0.5) * H * 0.6;
        const jitterX = (Math.random() - 0.5) * W * 0.6;
        switch (side) {
            case 'left':   return { x: 60,      y: H / 2 + jitterY };
            case 'top':    return { x: W / 2 + jitterX, y: 60 };
            case 'bottom': return { x: W / 2 + jitterX, y: H - 60 };
            case 'right':
            default:       return { x: W - 60,  y: H / 2 + jitterY };
        }
    }

    function buildInfiniteWave(waveNum, canvasSize) {
        const W = (canvasSize && canvasSize.w) || 1280;
        const H = (canvasSize && canvasSize.h) || 720;
        const spawnX = W - 80;
        const spawns = [];
        // 波數 5+ 後解鎖 4 面八方進攻
        const multiSide = waveNum >= 5;

        // 難度倍率 — 比之前更陡
        const hpMul = 1 + (waveNum - 1) * 0.12;                       // HP 每波 +12%
        const speedMul = 1 + Math.min(1.0, (waveNum - 1) * 0.04);     // 速度 +4%/波, 上限 2x
        const damageMul = 1 + Math.min(0.8, (waveNum - 1) * 0.025);   // 傷害 +2.5%/波, 上限 1.8x

        // 逐步引入新敵種
        const pool = ['skeleton'];
        if (waveNum >= 2) pool.push('assassin');
        if (waveNum >= 3) pool.push('warlock');
        if (waveNum >= 4) pool.push('bomber');
        if (waveNum >= 5) pool.push('gargoyle');
        if (waveNum >= 7) pool.push('archer');

        // 敵人數量 — 上限提高至 10, 遞增較快
        const baseCount = Math.min(10, 2 + Math.floor((waveNum - 1) / 1.5));

        // Boss 頻率: 每 6 波 (取代原本每 8 波)
        const isBoss = waveNum % 6 === 0;

        if (isBoss) {
            const demonCount = 1 + Math.min(2, Math.floor(waveNum / 12));
            for (let i = 0; i < demonCount; i++) {
                const pos = multiSide ? pickSpawnPos(W, H) : { x: spawnX, y: H * 0.5 + (i - (demonCount - 1) / 2) * 160 };
                spawns.push({ type: 'demon', x: pos.x, y: pos.y });
            }
            const support = Math.min(3, Math.floor(waveNum / 5));
            for (let i = 0; i < support; i++) {
                const t = pool[Math.floor(Math.random() * pool.length)];
                const pos = multiSide ? pickSpawnPos(W, H) : { x: spawnX, y: H * (0.2 + Math.random() * 0.6) };
                spawns.push({ type: t, x: pos.x, y: pos.y });
            }
        } else {
            for (let i = 0; i < baseCount; i++) {
                let t;
                const roll = Math.random();
                if (waveNum >= 8 && roll < Math.min(0.35, 0.08 + (waveNum - 8) * 0.02)) t = 'gargoyle';
                else if (waveNum >= 2 && roll < 0.3) t = 'assassin';
                else if (waveNum >= 3 && roll < 0.55) t = 'warlock';
                else t = 'skeleton';
                if (pool.indexOf(t) < 0) t = 'skeleton';
                const pos = multiSide ? pickSpawnPos(W, H) : { x: spawnX, y: H * (0.2 + (i + 0.5) / baseCount * 0.6) };
                spawns.push({ type: t, x: pos.x, y: pos.y });
            }
            if (waveNum >= 10 && waveNum % 3 === 2 && Math.random() < 0.4) {
                const pos = multiSide ? pickSpawnPos(W, H) : { x: spawnX, y: H * 0.5 };
                spawns.push({ type: 'demon', x: pos.x, y: pos.y });
            }
        }

        return { spawns, hpMul, speedMul, damageMul };
    }

    const LEVEL_INFO = [
        null,
        { num: 1, name: '墓園入口', desc: '初入秘境，擊退亡靈戰士' },
        { num: 2, name: '迷霧森林', desc: '遠程術士出沒，注意保持移動' },
        { num: 3, name: '遺忘神殿', desc: '石像鬼會蓄力重擊，記得舉盾' },
        { num: 4, name: '暗影小徑', desc: '敏捷刺客首次登場' },
        { num: 5, name: '血月峽谷', desc: '惡魔首戰，招式全開', boss: true },
        { num: 6, name: '枯骨祭壇', desc: '大量敵人襲來，磨練連擊' },
        { num: 7, name: '陰影迴廊', desc: '刺客成群，考驗反應' },
        { num: 8, name: '地底牢獄', desc: '連鎖石像鬼，舉盾時機關鍵' },
        { num: 9, name: '熔岩深淵', desc: '全兵種混戰' },
        { num: 10, name: '暴風之眼', desc: '雙生惡魔同時來襲', boss: true },
        { num: 11, name: '虛空邊境', desc: '精英部隊 + 惡魔援軍' },
        { num: 12, name: '惡魔王座', desc: '魔王回歸' },
        { num: 13, name: '暮色殿堂', desc: '石像鬼軍團集結' },
        { num: 14, name: '骸骨迴廊', desc: '亡靈大潮與惡魔援軍' },
        { num: 15, name: '魔焰之塔', desc: '雙惡魔同台 — 魔焰之王', boss: true },
        { num: 16, name: '失落遺跡', desc: '術士之海與雙惡魔' },
        { num: 17, name: '裂界之淵', desc: '刺客風暴，鬼影幢幢' },
        { num: 18, name: '元素熔爐', desc: '石像鬼群與惡魔降臨' },
        { num: 19, name: '邪神之眼', desc: '魔王群舞，考驗極限' },
        { num: 20, name: '終局之戰', desc: '三惡魔同襲', boss: true },
        { num: 21, name: '深淵入口', desc: '進入深淵, 難度陡升' },
        { num: 22, name: '腐朽迴廊', desc: '強化的亡靈部隊' },
        { num: 23, name: '黑曜城垛', desc: '精銳混編, 刺客潮' },
        { num: 24, name: '虛空祭壇', desc: '術士領軍壓境' },
        { num: 25, name: '深淵腐心', desc: 'Boss — 雙惡魔降臨', boss: true },
        { num: 26, name: '混沌走廊', desc: '石像鬼傾巢而出' },
        { num: 27, name: '裂空疆界', desc: '高速刺客, 牆邊作戰' },
        { num: 28, name: '黯滅迴廊', desc: '陰魔全兵種包圍' },
        { num: 29, name: '血色平原', desc: '雙波精銳' },
        { num: 30, name: '虛無之王', desc: 'Boss — 三惡魔肅立', boss: true },
        { num: 31, name: '熾燄之門', desc: '火光中的精銳' },
        { num: 32, name: '骨棘荒原', desc: '亡靈狂潮' },
        { num: 33, name: '影牢迷宮', desc: '刺客網' },
        { num: 34, name: '破損神廟', desc: '術士與石像鬼聯陣' },
        { num: 35, name: '滅世審判', desc: 'Boss — 惡魔大公', boss: true },
        { num: 36, name: '深淵海灣', desc: '全兵種狂歡' },
        { num: 37, name: '無盡深谷', desc: '連續精銳波' },
        { num: 38, name: '囚獄密室', desc: '刺客爆發場' },
        { num: 39, name: '滅絕之境', desc: '極限壓力' },
        { num: 40, name: '混沌深淵', desc: 'Boss — 四惡魔圍城', boss: true },
        { num: 41, name: '虛影之門', desc: '後期精銳戰場' },
        { num: 42, name: '煉獄之橋', desc: '石像鬼 + 惡魔援軍' },
        { num: 43, name: '虛空之矛', desc: '高速多敵' },
        { num: 44, name: '隕滅荒野', desc: '術士軍團壓境' },
        { num: 45, name: '最終試煉', desc: 'Boss — 惡魔軍團', boss: true },
        { num: 46, name: '虛無之境', desc: '接近神級難度' },
        { num: 47, name: '永夜之地', desc: '極限精銳潮' },
        { num: 48, name: '諸神黃昏', desc: '混合精銳轟炸' },
        { num: 49, name: '絕望之淵', desc: '決戰前夕' },
        { num: 50, name: '神級挑戰', desc: 'Boss — 終極魔王軍', boss: true }
    ];

    global.Enemies = {
        TYPES: ENEMY_TYPES,
        LEVEL_INFO: LEVEL_INFO,
        TOTAL_LEVELS: 50,
        getLevelScale: getLevelScale,
        createEnemy,
        updateEnemies,
        renderEnemies,
        renderEnemyProjectiles,
        getEnemyProjectiles,
        clearProjectiles,
        damageEnemy,
        buildLevel,
        buildInfiniteWave
    };
})(window);
